import json
import os

FILE_NAME = "novel_data.json"

def save_novel_data(data):
    with open(FILE_NAME, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_novel_data():
    if os.path.exists(FILE_NAME):
        with open(FILE_NAME, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "type": "novel",
        "name": "我的小说",
        "children": []
    }

def get_type_color(node_type):
    color_map = {
        "novel": "#4472C4",
        "volume": "#5B9BD5",
        "chapter": "#9BC2E6",
        "outline": "#70AD47",
        "storyline": "#C5E0B4",
        "character": "#ED7D31",
        "relation": "#FFE699",
        "inspire": "#FFC000"
    }
    return color_map.get(node_type, "#888888")
