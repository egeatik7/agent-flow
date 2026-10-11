#!/usr/bin/env python3
"""Build the viewer using an extracted Android SDK and the existing signing key."""
import argparse
import pathlib
import shutil
import subprocess
import tempfile
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--sdk', required=True, type=pathlib.Path)
parser.add_argument('--signing-key', required=True, type=pathlib.Path)
parser.add_argument('--password-file', required=True, type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parent
repo = root.parent
sdk = args.sdk.resolve()
tools = sdk / 'android-15'
platform = sdk / 'android-35/android.jar'
zxing = sdk / 'zxing-core-3.5.3.jar'

def run(*command):
    subprocess.run([str(part) for part in command], check=True)

args.output = args.output.resolve()
args.output.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='nubbo-apk-') as temp:
    work = pathlib.Path(temp)
    resources = work / 'res/drawable'
    resources.mkdir(parents=True)
    shutil.copyfile(repo / 'resources/icon.png', resources / 'icon.png')
    assets = work / 'assets'
    shutil.copytree(root / 'assets', assets)
    for name in ['xp.css', 'xp-luna.css']:
        shutil.copyfile(repo / 'src/styles' / name, assets / name)
    for name in ['nubbo-still.png', 'nubbo-logo.png']:
        shutil.copyfile(repo / 'src/assets' / name, assets / name)
    shutil.copyfile(repo / 'resources/icon.png', assets / 'icon.png')
    run(tools / 'aapt2', 'compile', '--dir', work / 'res', '-o', work / 'resources.zip')
    unsigned = work / 'unsigned.apk'
    run(tools / 'aapt2', 'link', '-o', unsigned, '--manifest', root / 'AndroidManifest.xml', '-I', platform, '-A', assets, work / 'resources.zip')
    classes = work / 'classes'
    classes.mkdir()
    run('java', '--module', 'jdk.compiler/com.sun.tools.javac.Main', '--release', '8', '-classpath', f'{platform}:{zxing}', '-d', classes, *sorted((root / 'src').rglob('*.java')))
    with zipfile.ZipFile(work / 'classes.jar', 'w') as jar:
        for path in classes.rglob('*.class'):
            jar.write(path, path.relative_to(classes))
    dex = work / 'dex'
    dex.mkdir()
    run(tools / 'd8', '--min-api', '26', '--lib', platform, '--output', dex, work / 'classes.jar', zxing)
    with zipfile.ZipFile(unsigned, 'a', zipfile.ZIP_DEFLATED) as apk:
        for path in dex.glob('*.dex'):
            apk.write(path, path.name)
    aligned = work / 'aligned.apk'
    run(tools / 'zipalign', '-f', '-p', '4', unsigned, aligned)
    run(tools / 'apksigner', 'sign', '--ks', args.signing_key.resolve(), '--ks-pass', 'file:' + str(args.password_file.resolve()), '--out', args.output, aligned)
    run(tools / 'apksigner', 'verify', '--verbose', args.output)
print('Built', args.output.name)
