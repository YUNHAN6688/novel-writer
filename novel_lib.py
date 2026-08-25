import tkinter as tk
from tkinter import ttk, simpledialog, messagebox
import json
import os

SAVE_FILE = "novel_data.json"

def load_novel_data():
    if os.path.exists(SAVE_FILE):
        with open(SAVE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "type": "novel",
        "name": "我的小说",
        "children": [
            {
                "type": "volume",
                "name": "第一卷",
                "children": []
            },
            {
                "type": "outline",
                "name": "大纲",
                "children": [
                    {"type": "character", "name": "人设", "children": []},
                    {"type": "relation", "name": "人物关系", "children": []},
                    {"type": "inspire", "name": "灵感", "children": []},
                ],
            },
        ],
    }

def save_novel_data(data):
    with open(SAVE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def get_type_color(node_type):
    color_map = {
        "novel": "#ff6b6b",
        "volume": "#4ecdc4",
        "chapter": "#60a5fa",
        "outline": "#ffe066",
        "character": "#a855f7",
        "relation": "#3b82f6",
        "inspire": "#22c55e",
    }
    return color_map.get(node_type, "#888888")

def build_tree(tree, parent, data, id_map):
    node_id = tree.insert(parent, tk.END, text=data["name"], values=(data["type"],))
    id_map[node_id] = data
    if "children" in data:
        for child in data["children"]:
            build_tree(tree, node_id, child, id_map)
    return node_id

def refresh_tree(tree, root_data, id_map):
    tree.delete(*tree.get_children())
    id_map.clear()
    build_tree(tree, "", root_data, id_map)

def right_click_menu(event, tree, root_data, id_map):
    item = tree.identify_row(event.y)
    if not item:
        return
    tree.selection_set(item)
    menu = tk.Menu(tree, tearoff=0)
    menu.add_command(label="新建子项", command=lambda: create_new_node(tree, item, root_data, id_map))
    menu.tk_popup(event.x_root, event.y_root)

def create_new_node(tree, parent_item, root_data, id_map):
    new_name = simpledialog.askstring("新建", "请输入名称：")
    if not new_name:
        return

    parent_node = id_map[parent_item]
    if "children" not in parent_node:
        parent_node["children"] = []

    new_node = None
    if parent_node["type"] == "novel":
        win = tk.Toplevel()
        win.title("选择类型")
        win.geometry("220x100")
        win.transient(tree)
        win.grab_set()
        var = tk.StringVar(value="volume")
        ttk.Radiobutton(win, text="卷(volume)", variable=var, value="volume").pack(pady=3)
        ttk.Radiobutton(win, text="大纲(outline)", variable=var, value="outline").pack(pady=3)
        def confirm():
            nonlocal new_node
            choice = var.get()
            if choice == "volume":
                new_node = {"type": choice, "name": new_name, "children": []}
            else:
                new_node = {"type": choice, "name": new_name, "children": []}
            win.destroy()
        ttk.Button(win, text="确定", command=confirm).pack(pady=5)
        tree.wait_window(win)

    elif parent_node["type"] == "volume":
        new_node = {"type": "chapter", "name": new_name, "content": ""}

    elif parent_node["type"] == "outline":
        win = tk.Toplevel()
        win.title("选择类型")
        win.geometry("260x140")
        win.transient(tree)
        win.grab_set()
        var = tk.StringVar(value="character")
        ttk.Radiobutton(win, text="人设(character)", variable=var, value="character").pack(pady=2)
        ttk.Radiobutton(win, text="人物关系(relation)", variable=var, value="relation").pack(pady=2)
        ttk.Radiobutton(win, text="灵感(inspire)", variable=var, value="inspire").pack(pady=2)
        def confirm():
            nonlocal new_node
            choice = var.get()
            new_node = {"type": choice, "name": new_name, "children": []}
            win.destroy()
        ttk.Button(win, text="确定", command=confirm).pack(pady=5)
        tree.wait_window(win)
    elif parent_node["type"] in ("character", "relation", "inspire"):
        new_node = {"type": parent_node["type"], "name": new_name, "content": ""}
    else:
        messagebox.showinfo("提示", "该节点不能新建子节点")
        return

    if new_node is None:
        return
    parent_node["children"].append(new_node)
    save_novel_data(root_data)
    refresh_tree(tree, root_data, id_map)

def double_click_open(event, tree, text_widget, id_map):
    selected = tree.selection()
    if not selected:
        return
    item_id = selected[0]
    node_type = tree.item(item_id)["values"][0]
    node_name = tree.item(item_id)["text"]
    node_data = id_map[item_id]

    # ✅ 只在加载内容时临时开启可写，加载完成**不锁定**
    text_widget.config(state=tk.NORMAL)
    text_widget.delete(1.0, tk.END)
    color = get_type_color(node_type)

    bar_text = f"==== {node_name} 【{node_type}】 ====\n"
    text_widget.insert(tk.END, bar_text)
    text_widget.tag_config("color_bar", foreground="white", background=color, font=("微软雅黑",11,"bold"))
    text_widget.tag_add("color_bar", "1.0", "2.0")

    content = node_data.get("content", "")
    text_widget.insert(tk.END, content)
    # ❗删掉原来的 state=DISABLED，文本框保持可输入！

def save_edit_content(text_widget, tree, id_map, root_data):
    selected = tree.selection()
    if not selected:
        messagebox.showinfo("提示", "请先双击选择一个节点")
        return
    item_id = selected[0]
    node = id_map[item_id]
    if "content" not in node:
        messagebox.showwarning("提示", "该节点不能编辑内容")
        return

    # 第一行是标题栏，所以从2.0开始读取正文
    full_text = text_widget.get("2.0", tk.END).strip("\n")
    node["content"] = full_text
    save_novel_data(root_data)
    messagebox.showinfo("成功", "内容已保存")

def build_main_window(root, novel_data):
    root.title("小说写作软件")
    root.geometry("1100x700")

    paned = ttk.PanedWindow(root, orient=tk.HORIZONTAL)
    paned.pack(fill=tk.BOTH, expand=1)

    left_frame = ttk.Frame(paned)
    paned.add(left_frame, weight=1)
    tree = ttk.Treeview(left_frame, columns=("type",), show="tree")
    tree.heading("#0", text="小说目录")
    tree.column("#0", width=220)
    tree.column("type", width=0, stretch=False)
    tree.pack(fill=tk.BOTH, expand=1, padx=5, pady=5)

    id_map = dict()
    refresh_tree(tree, novel_data, id_map)

    right_frame = ttk.Frame(paned)
    paned.add(right_frame, weight=3)
    # ✅ 文本框默认可编辑
    text_area = tk.Text(right_frame, font=("微软雅黑",11), wrap=tk.WORD)
    text_area.pack(fill=tk.BOTH, expand=1, padx=5, pady=5)

    btn_frame = ttk.Frame(right_frame)
    btn_frame.pack(fill=tk.X, padx=5, pady=2)
    save_btn = ttk.Button(btn_frame, text="保存编辑内容", command=lambda: save_edit_content(text_area, tree, id_map, novel_data))
    save_btn.pack(side=tk.RIGHT)

    tree.bind("<Button-3>", lambda e: right_click_menu(e, tree, novel_data, id_map))
    tree.bind("<Double-1>", lambda e: double_click_open(e, tree, text_area, id_map))
    return tree, text_area, id_map
