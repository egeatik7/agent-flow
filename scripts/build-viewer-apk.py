"""Build the small native viewer without Electron, OCR, Python in the APK, or Gradle plugins.

Requires JDK 17, Android SDK platform 35/build-tools 35, and ZXing core 3.5.3.
The signing key is an external, private file: never commit it to the source repository.
"""
import argparse
import os
import pathlib
import secrets
import shutil
import subprocess
import tempfile
import zipfile

p=argparse.ArgumentParser()
p.add_argument('--sdk',required=True,type=pathlib.Path)
p.add_argument('--zxing',required=True,type=pathlib.Path)
p.add_argument('--key',required=True,type=pathlib.Path)
p.add_argument('--password-file',required=True,type=pathlib.Path)
p.add_argument('--out',required=True,type=pathlib.Path)
a=p.parse_args()
repo=pathlib.Path(__file__).resolve().parents[1]
jar=next(a.sdk.rglob('android.jar'))
tools=next(a.sdk.rglob('aapt2.exe' if os.name=='nt' else 'aapt2')).parent
def tool(name):
    suffix='.exe' if os.name=='nt' and name in ('aapt2','zipalign') else '.bat' if os.name=='nt' else ''
    f=tools/(name+suffix)
    if os.name!='nt':f.chmod(f.stat().st_mode|0o111)
    return str(f)
def run(*cmd):subprocess.run([str(s) for s in cmd],check=True)
a.out=a.out.resolve();a.key=a.key.resolve();a.password_file=a.password_file.resolve();a.zxing=a.zxing.resolve()
a.out.parent.mkdir(parents=True,exist_ok=True);a.key.parent.mkdir(parents=True,exist_ok=True)
if not a.key.exists():
    if not a.password_file.exists():a.password_file.write_text(secrets.token_hex(24)+'\n');a.password_file.chmod(0o600)
    run('keytool','-genkeypair','-keystore',a.key,'-storepass:file',a.password_file,'-keypass:file',a.password_file,'-alias','nubbo-viewer','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Nubbo Viewer,O=Nubbo')
with tempfile.TemporaryDirectory(prefix='nubbo-apk-') as tmp:
    work=pathlib.Path(tmp);classes=work/'classes';classes.mkdir();res=work/'res'/'drawable';res.mkdir(parents=True)
    shutil.copyfile(repo/'resources/icon.png',res/'icon.png')
    compiler=['javac'] if shutil.which('javac') else ['java','--module','jdk.compiler/com.sun.tools.javac.Main']
    run(*compiler,'--release','8','-cp',os.pathsep.join([str(jar),str(a.zxing)]),'-d',classes,*sorted((repo/'android-viewer/src').rglob('*.java')))
    run(tool('d8'),'--lib',jar,'--min-api','26','--output',work,*sorted(classes.rglob('*.class')),a.zxing)
    run(tool('aapt2'),'compile','--dir',res.parent,'-o',work/'resources.zip')
    run(tool('aapt2'),'link','-I',jar,'--manifest',repo/'android-viewer/AndroidManifest.xml','-o',work/'unsigned.apk',work/'resources.zip')
    with zipfile.ZipFile(work/'unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:z.write(work/'classes.dex','classes.dex')
    run(tool('zipalign'),'-f','4',work/'unsigned.apk',work/'aligned.apk')
    run(tool('apksigner'),'sign','--ks',a.key,'--ks-key-alias','nubbo-viewer','--ks-pass','file:'+str(a.password_file),'--out',a.out,work/'aligned.apk')
    run(tool('apksigner'),'verify','--verbose',a.out)
    run(tool('aapt2'),'dump','badging',a.out)
print('Built:',a.out)
