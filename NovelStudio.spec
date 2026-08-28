# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = [('static', 'static')]
binaries = []
hiddenimports = ['app', 'clr']
for _pkg in ('webview', 'clr_loader', 'pythonnet'):
    _t = collect_all(_pkg)
    datas += _t[0]; binaries += _t[1]; hiddenimports += _t[2]


a = Analysis(
    ['novel_app.py'],
    pathex=[SPECPATH],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='NovelStudio',
    icon='assets/icon.ico',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='NovelStudio',
)
