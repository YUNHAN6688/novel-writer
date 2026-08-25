import tkinter as tk
from ui_builder import build_main_window
from data_handler import load_novel_data

if __name__ == "__main__":
    root = tk.Tk()
    novel_data = load_novel_data()
    build_main_window(root, novel_data)
    root.mainloop()
