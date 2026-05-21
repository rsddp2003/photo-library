#!/usr/bin/env python3
"""
CLIP + TSP photo sorting for the local library.

This adapts the reference implementation in:
/Users/zhujiabo/phototry/travel-shots-main/scripts/clip_sort_tsp_breakpoint.py

The algorithm keeps the same core flow:
1. extract CLIP embeddings with timm vit_large_patch14_clip_336
2. compute cosine-distance matrix
3. build a nearest-neighbor TSP path
4. improve with 2-opt
5. cut the ring at the least-similar edge
"""
import argparse
import json
import os
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps
from sklearn.metrics.pairwise import cosine_similarity
import timm
from timm.data import resolve_data_config
from timm.data.transforms_factory import create_transform


ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "library.json"
UPLOAD_DIR = ROOT / "data" / "uploads"
MODEL_NAME = "vit_large_patch14_clip_336"


def load_model():
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = timm.create_model(MODEL_NAME, pretrained=True, num_classes=0)
    model = model.to(device)
    model.eval()
    transform = create_transform(**resolve_data_config({}, model=model))
    return model, transform, device


def extract_embeddings(model, transform, device, image_paths, batch_size=8):
    embeddings = []
    for i in range(0, len(image_paths), batch_size):
        batch_paths = image_paths[i:i + batch_size]
        batch_tensors = []

        for path in batch_paths:
            try:
                img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
                batch_tensors.append(transform(img))
            except Exception:
                batch_tensors.append(None)

        valid_tensors = [tensor for tensor in batch_tensors if tensor is not None]
        if not valid_tensors:
            embeddings.extend(np.zeros(768) for _ in batch_tensors)
            continue

        batch = torch.stack(valid_tensors).to(device)
        with torch.no_grad():
            features = model(batch)
            features = features / features.norm(dim=-1, keepdim=True)

        feature_index = 0
        for tensor in batch_tensors:
            if tensor is None:
                embeddings.append(np.zeros(768))
            else:
                embeddings.append(features[feature_index].cpu().numpy())
                feature_index += 1

    return np.array(embeddings)


def tsp_nearest_neighbor(distance_matrix, start=0):
    n = len(distance_matrix)
    visited = [False] * n
    path = [start]
    visited[start] = True
    current = start

    while len(path) < n:
        min_dist = float("inf")
        next_node = -1
        for j in range(n):
            if not visited[j] and distance_matrix[current][j] < min_dist:
                min_dist = distance_matrix[current][j]
                next_node = j
        if next_node == -1:
            break
        visited[next_node] = True
        path.append(next_node)
        current = next_node

    return path


def two_opt(path, distance_matrix, max_iterations=100):
    n = len(path)
    improved = True
    iteration = 0

    while improved and iteration < max_iterations:
        improved = False
        for i in range(1, n - 1):
            for j in range(i + 1, n):
                current_dist = distance_matrix[path[i - 1]][path[i]] + distance_matrix[path[j]][path[(j + 1) % n]]
                new_dist = distance_matrix[path[i - 1]][path[j]] + distance_matrix[path[i]][path[(j + 1) % n]]
                if new_dist < current_dist:
                    path[i:j + 1] = reversed(path[i:j + 1])
                    improved = True
        iteration += 1

    return path


def find_best_breakpoint(path, distance_matrix):
    max_dist = -1
    best_breakpoint = 0
    for i in range(len(path)):
        j = (i + 1) % len(path)
        dist = distance_matrix[path[i]][path[j]]
        if dist > max_dist:
            max_dist = dist
            best_breakpoint = j
    return path[best_breakpoint:] + path[:best_breakpoint]


def tsp_with_breakpoint(embeddings):
    sim_matrix = cosine_similarity(embeddings)
    distance_matrix = 1 - sim_matrix
    start = 0
    max_sim = -1

    for i in range(len(sim_matrix)):
        for j in range(i + 1, len(sim_matrix)):
            if sim_matrix[i][j] > max_sim:
                max_sim = sim_matrix[i][j]
                start = i

    path = tsp_nearest_neighbor(distance_matrix, start)
    path = two_opt(path, distance_matrix)
    return find_best_breakpoint(path, distance_matrix)


def find_album(library, year_value, location_id):
    for year in library.get("years", []):
        if str(year.get("year")) != str(year_value):
            continue
        for location in year.get("locations", []):
            if location.get("id") == location_id:
                return location
    return None


def photo_path(photo):
    filename = str(photo.get("url", "")).replace("/uploads/", "")
    return UPLOAD_DIR / filename


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", required=True)
    parser.add_argument("--location-id", required=True)
    args = parser.parse_args()

    library = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    album = find_album(library, args.year, args.location_id)
    if not album:
        raise SystemExit("album not found")

    photos = album.get("photos", [])
    if len(photos) < 2:
        for index, photo in enumerate(photos):
            photo["sortIndex"] = index
        album["sortStatus"] = "sorted"
        album.pop("sortError", None)
        DATA_FILE.write_text(json.dumps(library, ensure_ascii=False, indent=2), encoding="utf-8")
        return

    image_paths = [photo_path(photo) for photo in photos]
    existing = [(photo, path) for photo, path in zip(photos, image_paths) if path.exists()]
    if len(existing) < 2:
        raise SystemExit("not enough local images for CLIP sorting")

    model, transform, device = load_model()
    embeddings = extract_embeddings(model, transform, device, [path for _, path in existing])
    order = tsp_with_breakpoint(embeddings)
    sorted_ids = [existing[index][0]["id"] for index in order]

    id_to_rank = {photo_id: index for index, photo_id in enumerate(sorted_ids)}
    for fallback_index, photo in enumerate(photos, start=len(id_to_rank)):
        photo["sortIndex"] = id_to_rank.get(photo["id"], fallback_index)

    album["photos"].sort(key=lambda photo: photo.get("sortIndex", 10**9))
    album["sortStatus"] = "sorted"
    album.pop("sortError", None)
    DATA_FILE.write_text(json.dumps(library, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
