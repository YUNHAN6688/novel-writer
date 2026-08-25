
import tkinter as tk
from tkinter import ttk
from tkinter import simpledialog
from tkinter import messagebox

from data_handler import save_novel_data, get_type_color
# ✅ 从独立文件夹导入故事线树组件
from storyline import StoryLineTreeEditor

def sort_root_children(root_node):
    if root_node["type"] != "novel":
        return
    if "children" not in root_node:
        return
    volumes = []
    others = []
    for child in root_node["children"]:
        if child["type"] == "volume":
            volumes.append(child)
        else:
            others.append(child)
    root_node["children"] = volumes + others

def get_real_expanded_data(tree, id_map, parent="", expanded_data_set=None):
    if expanded_data_set is None:
        expanded_data_set = set()
    for iid in tree.get_children(parent):
        if tree.item(iid, "open"):
            node_data = id_map[iid]
            expanded_data_set.add(id(node_data))
            get_real_expanded_data(tree, id_map, iid, expanded_data_set)
    return expanded_data_set

def rebuild_tree_only_expand_specified(tree, root_data, id_map, expanded_data_set, target_data=None):
    tree.delete(*tree.get_children())
    id_map.clear()

    def build(parent_iid, node, level=0):
        indent = "  " * level
        node_id = tree.insert(parent_iid, tk.END, text=indent + node["name"], values=(node["type"],))
        id_map[node_id] = node
        if id(node) in expanded_data_set:
            tree.item(node_id, open=True)
        if "children" in node:
            for child in node["children"]:
                build(node_id, child, level + 1)
    build("", root_data, 0)

    if target_data is not None:
        for iid, d in id_map.items():
            if d is target_data:
                tree.selection_set(iid)
                tree.focus(iid)
                bbox = tree.bbox(iid)
                if bbox:
                    tree.yview_moveto(bbox[1] / tree.winfo_height())
                break

def right_click_menu(event, tree, root_data, id_map):
    item = tree.identify_row(event.y)
    if not item:
        return
    tree.selection_set(item)
    tree.focus(item)
    node_data = id_map[item]
    menu = tk.Menu(tree, tearoff=0)

    if node_data["type"] == "novel":
        menu.add_command(label="新建卷(volume)", command=lambda: create_new_node(tree, item, root_data, id_map, "volume"))
        menu.add_command(label="新建大纲(outline)", command=lambda: create_new_node(tree, item, root_data, id_map, "outline"))
    elif node_data["type"] == "outline":
        menu.add_command(label="新建人设(character)", command=lambda: create_new_node(tree, item, root_data, id_map, "character"))
        menu.add_command(label="新建人物关系(relation)", command=lambda: create_new_node(tree, item, root_data, id_map, "relation"))
        menu.add_command(label="新建灵感(inspire)", command=lambda: create_new_node(tree, item, root_data, id_map, "inspire"))
        menu.add_command(label="新建故事线(storyline)", command=lambda: create_new_node(tree, item, root_data, id_map, "storyline"))
    elif node_data["type"] == "volume":
        menu.add_command(label="新建章节(chapter)", command=lambda: create_new_node(tree, item, root_data, id_map, "chapter"))
    elif node_data["type"] in ("character", "relation", "inspire"):
        menu.add_command(label="新建子项", command=lambda: create_new_node(tree, item, root_data, id_map, node_data["type"]))

    menu.add_separator()
    menu.add_command(label="重命名", command=lambda: rename_node(tree, item, root_data, id_map))
    menu.add_command(label="删除", command=lambda: delete_node(tree, item, root_data, id_map))
    try:
        menu.tk_popup(event.x_root, event.y_root)
    finally:
        menu.grab_release()

def create_new_node(tree, parent_item, root_data, id_map, node_type):
    new_name = simpledialog.askstring("新建节点", "请输入节点名称：")
    if not new_name:
        return

    parent_node = id_map[parent_item]
    if "children" not in parent_node:
        parent_node["children"] = []

    if node_type == "storyline":
        new_node = {"type": "storyline", "name": new_name, "tree_data": []}
    elif node_type == "volume":
        new_node = {"type": "volume", "name": new_name, "content": "", "children": []}
    elif node_type == "chapter":
        new_node = {"type": "chapter", "name": new_name, "content": ""}
    elif node_type == "outline":
        new_node = {"type": "outline", "name": new_name, "children": []}
    elif node_type in ("character", "relation", "inspire"):
        new_node = {"type": node_type, "name": new_name, "note": ""}
    else:
        return

    parent_node["children"].append(new_node)
    if parent_node["type"] == "novel":
        sort_root_children(parent_node)

    save_novel_data(root_data)
    expanded_set = get_real_expanded_data(tree, id_map)
    rebuild_tree_only_expand_specified(tree, root_data, id_map, expanded_set, target_data=new_node)

def rename_node(tree, item_id, root_data, id_map):
    node_data = id_map[item_id]
    new_name = simpledialog.askstring("重命名", "请输入新名称：", initialvalue=node_data["name"])
    if not new_name:
        return
    node_data["name"] = new_name
    if root_data["children"] and node_data in root_data["children"]:
        sort_root_children(root_data)
    save_novel_data(root_data)
    expanded_set = get_real_expanded_data(tree, id_map)
    rebuild_tree_only_expand_specified(tree, root_data, id_map, expanded_set, target_data=node_data)

def delete_node(tree, item_id, root_data, id_map):
    node_data = id_map[item_id]
    if node_data["type"] == "novel":
        messagebox.showwarning("警告", "根节点不能删除！")
        return
    confirm = messagebox.askyesno("确认删除", f"确定要删除【{node_data['name']}】及其所有子项吗？")
    if not confirm:
        return
    def remove_child(parent):
        if "children" not in parent:
            return False
        for idx, child in enumerate(parent["children"]):
            if child is node_data:
                del parent["children"][idx]
                return True
            if remove_child(child):
                return True
        return False
    remove_child(root_data)
    sort_root_children(root_data)
    save_novel_data(root_data)
    expanded_set = get_real_expanded_data(tree, id_map)
    rebuild_tree_only_expand_specified(tree, root_data, id_map, expanded_set)

right_panel_widget = None

def double_click_open(event, tree, right_frame, id_map, root_data):
    global right_panel_widget
    for w in right_frame.winfo_children():
        w.destroy()
    right_panel_widget = None

    selected = tree.selection()
    if not selected:
        return
    item_id = selected[0]
    node_data = id_map[item_id]
    node_type = node_data["type"]

    if node_type == "storyline":
        # 调用独立文件夹里的故事线树组件
        right_panel_widget = StoryLineTreeEditor(
            right_frame,
            node_data,
            lambda: save_novel_data(root_data)
        )
    else:
        text_widget = tk.Text(right_frame, font=("微软雅黑",11), wrap=tk.WORD)
        text_widget.pack(fill=tk.BOTH, expand=1, padx=5, pady=5)
        btn_frame = ttk.Frame(right_frame)
        btn_frame.pack(fill=tk.X, padx=5, pady=2)
        def save_text():
            raw_text = text_widget.get("1.0", tk.END).strip()
            lines = raw_text.splitlines()
            if lines and lines[0].startswith("==== "):
                body = "\n".join(lines[1:])
            else:
                body = raw_text
            if node_type in ("character", "relation", "inspire"):
                node_data["note"] = body
            else:
                node_data["content"] = body
            save_novel_data(root_data)
            messagebox.showinfo("成功", "内容已保存")
        ttk.Button(btn_frame, text="保存编辑内容", command=save_text).pack(side=tk.RIGHT)

        color = get_type_color(node_type)
        if node_type in ("character", "relation", "inspire"):
            header = f"==== {node_data['name']} 【标注】 ====\n"
            content = node_data.get("note", "")
        else:
            header = f"==== {node_data['name']} 【正文】 ====\n"
            content = node_data.get("content", "")
        text_widget.insert(tk.END, header)
        text_widget.insert(tk.END, content)
        text_widget.tag_config("color_bar", foreground="white", background=color, font=("微软雅黑",11,"bold"))
        text_widget.tag_add("color_bar", "1.0", "2.0")
        right_panel_widget = text_widget

def build_main_window(root, novel_data):
    root.title("小说写作软件")
    root.geometry("1100x700")
    sort_root_children(novel_data)

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
    empty_expand = set()
    rebuild_tree_only_expand_specified(tree, novel_data, id_map, empty_expand)

    right_frame = ttk.Frame(paned)
    paned.add(right_frame, weight=3)

    tree.bind("<Button-3>", lambda e: right_click_menu(e, tree, novel_data, id_map))
    tree.bind("<Double-1>", lambda e: double_click_open(e, tree, right_frame, id_map, novel_data))
    return tree, right_frame, id_map
