import os
import json
import re

IMAGE_FOLDER = "images"
OUTPUT_FILE = "images.json"

allowed_extensions = (
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".avif"
)

def natural_sort_key(filename):
    return [
        int(part) if part.isdigit() else part.lower()
        for part in re.split(r"(\d+)", filename)
    ]

images = [
    filename
    for filename in os.listdir(IMAGE_FOLDER)
    if filename.lower().endswith(allowed_extensions)
]

images.sort(key=natural_sort_key)

with open(OUTPUT_FILE, "w", encoding="utf-8") as file:
    json.dump(images, file, indent=2)

print(f"Generated {OUTPUT_FILE} with {len(images)} images.")