package com.nubbo.viewer;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.hardware.Camera;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.widget.*;
import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;

/** A network viewer only. No file access, JavaScript/native bridge or automation engine. */
public final class MainActivity extends Activity {
 private WebView web;
 private Camera camera;
 private boolean scanning;
 private String currentUrl;
 private long lastScan;
 private final ExecutorService decoder=Executors.newSingleThreadExecutor();
 private final AtomicBoolean decoding=new AtomicBoolean(false);
 private int dp(int n){return (int)(n*getResources().getDisplayMetrics().density+.5f);}
 @Override public void onCreate(Bundle state){super.onCreate(state);getWindow().setStatusBarColor(Color.rgb(0,82,200));getWindow().setNavigationBarColor(Color.rgb(236,233,216));showConnections();}
 private android.graphics.drawable.GradientDrawable paint(int top,int bottom,int stroke){android.graphics.drawable.GradientDrawable d=new android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,new int[]{top,bottom});d.setStroke(dp(1),stroke);d.setCornerRadius(dp(3));return d;}
 private LinearLayout panel(String title){if(web!=null){web.destroy();web=null;}LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.rgb(236,233,216));TextView h=new TextView(this);h.setText("Nubbo Agent Studio · "+title);h.setTextSize(13);h.setTypeface(android.graphics.Typeface.DEFAULT,android.graphics.Typeface.BOLD);h.setTextColor(Color.WHITE);h.setGravity(android.view.Gravity.CENTER_VERTICAL);h.setPadding(dp(8),0,dp(8),0);h.setBackground(paint(0xff0997ff,0xff003dd7,0xff0842c6));root.addView(h,new LinearLayout.LayoutParams(-1,dp(34)));ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);l.setPadding(dp(12),dp(12),dp(12),dp(12));scroll.addView(l);setContentView(root);insets(root);return l;}
 private void insets(View v){v.setOnApplyWindowInsetsListener((view,i)->{view.setPadding(0,i.getSystemWindowInsetTop(),0,i.getSystemWindowInsetBottom());return i;});v.requestApplyInsets();}
 private void text(LinearLayout l,String s){TextView t=new TextView(this);t.setText(s);t.setTextSize(13);t.setTextColor(Color.BLACK);t.setPadding(0,dp(8),0,dp(8));l.addView(t);}
 private void button(LinearLayout l,String s,Runnable action){Button b=new Button(this);b.setText(s);b.setAllCaps(false);b.setTextSize(13);b.setTextColor(Color.BLACK);b.setTypeface(android.graphics.Typeface.DEFAULT);android.graphics.drawable.StateListDrawable states=new android.graphics.drawable.StateListDrawable();states.addState(new int[]{android.R.attr.state_pressed},paint(0xffd8d4c8,0xffece9d8,0xff003c74));states.addState(new int[]{},paint(0xffffffff,0xffd4d0c4,0xff003c74));b.setBackground(states);b.setOnClickListener(v->action.run());LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,dp(44));params.setMargins(0,dp(6),0,dp(6));l.addView(b,params);}
 private List<String> saved(){List<String> result=new ArrayList<>();try{JSONArray a=new JSONArray(getPreferences(0).getString("computers","[]"));for(int i=0;i<a.length();i++)if(valid(a.getString(i)))result.add(a.getString(i));}catch(Exception ignored){}return result;}
 private String asset(String name){try(java.io.InputStream in=getAssets().open(name);java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);return new String(out.toByteArray(),java.nio.charset.StandardCharsets.UTF_8);}catch(java.io.IOException e){throw new IllegalStateException("Arayüz dosyası açılamadı",e);}}
 private String image(String name){try(java.io.InputStream in=getAssets().open(name);java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);return "data:image/png;base64,"+android.util.Base64.encodeToString(out.toByteArray(),android.util.Base64.NO_WRAP);}catch(java.io.IOException e){throw new IllegalStateException("Arayüz görseli açılamadı",e);}}
 private static String html(String s){return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;");}
 private void localPage(String content){
  if(web!=null){web.destroy();web=null;}web=new WebView(this);web.setBackgroundColor(Color.rgb(236,233,216));web.getSettings().setJavaScriptEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest req){Uri u=req.getUrl();if(!req.isForMainFrame()||!"nubbo".equals(u.getScheme()))return true;String command=u.getHost();if("connect".equals(command)){String url=u.getQueryParameter("url");if(url!=null)open(url);}else if("scan".equals(command)){if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.CAMERA},7);else showScanner();}else if("retry".equals(command)&&currentUrl!=null)showViewer(currentUrl);else if("computers".equals(command))showConnections();return true;}});
  String page=asset("connections.html").replace("{{STYLE}}",asset("xp.css")+"\n"+asset("xp-luna.css")).replace("{{CONTENT}}",content).replace("{{ICON}}",image("icon.png")).replace("{{MASCOT}}",image("nubbo-still.png")).replace("{{LOGO}}",image("nubbo-logo.png"));
  LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);l.setBackgroundColor(Color.rgb(236,233,216));l.addView(web,new LinearLayout.LayoutParams(-1,-1));setContentView(l);insets(l);web.loadDataWithBaseURL("https://nubbo.local/",page,"text/html","UTF-8",null);
 }
 private void showConnections(){releaseCamera();scanning=false;getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  StringBuilder content=new StringBuilder("<h2>Bilgisayara bağlan</h2><p>PC ve tablette Tailscale açık olmalı. PC’de Nubbo → Tablet İzleme → İzlemeyi Aç.</p>");List<String> computers=saved();
  if(!computers.isEmpty()){content.append("<section class='connection-section'><h3>Kayıtlı bilgisayarlar</h3>");for(String u:computers)content.append("<a class='xp-btn connection-pc' href='nubbo://connect?url=").append(html(Uri.encode(u))).append("'>").append(html(Uri.parse(u).getHost())).append(" · Bağlan</a>");content.append("</section>");}
  content.append("<a class='xp-btn primary' href='nubbo://scan'>PC’deki QR Kodunu Okut</a><section class='connection-section'><h3>Eşleştirme bağlantısı</h3><form onsubmit=\"event.preventDefault();location.href='nubbo://connect?url='+encodeURIComponent(document.getElementById('address').value.trim())\"><textarea id='address' aria-label='Eşleştirme bağlantısı' placeholder='PC’den kopyaladığın bağlantıyı buraya yapıştır' autocomplete='off' autocapitalize='off' spellcheck='false'></textarea><button class='xp-btn' type='submit'>Bağlan</button></form></section><p class='connection-hint'>Tuvali kaydır, paketlere gir, çalışan adımı ve günlükleri incele.</p>");localPage(content.toString());
 }
 static boolean valid(String value){try{Uri u=Uri.parse(value);return "https".equals(u.getScheme())&&u.getHost()!=null&&u.getHost().matches("[a-zA-Z0-9.-]+\\.ts\\.net")&&(u.getPort()==8443||u.getPort()==443||u.getPort()==-1)&&"/viewer".equals(u.getPath())&&u.getUserInfo()==null&&u.getQuery()==null&&u.getFragment()!=null&&u.getFragment().matches("token=[a-f0-9]{64}");}catch(Exception e){return false;}}
 private void open(String url){if(!valid(url)){Toast.makeText(this,"Nubbo’nun verdiği HTTPS eşleştirme bağlantısını kullan.",Toast.LENGTH_LONG).show();return;}releaseCamera();scanning=false;List<String> computers=saved();computers.removeIf(v->Uri.parse(v).getAuthority().equals(Uri.parse(url).getAuthority()));computers.add(0,url);getPreferences(0).edit().putString("computers",new JSONArray(computers.subList(0,Math.min(10,computers.size()))).toString()).apply();currentUrl=url;showViewer(url);}
 private void showViewer(String url){if(web!=null)web.destroy();web=new WebView(this);web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);web.getSettings().setSafeBrowsingEnabled(true);web.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);web.setWebViewClient(new WebViewClient(){
  @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){Uri u=request.getUrl(),peer=Uri.parse(currentUrl);return !"https".equals(u.getScheme())||!Objects.equals(u.getAuthority(),peer.getAuthority());}
  @Override public void onReceivedError(WebView view,WebResourceRequest req,WebResourceError error){if(req.isForMainFrame())runOnUiThread(()->localPage("<h2>PC’ye ulaşılamadı</h2><p>Tailscale bağlantısını ve PC’de Nubbo’nun açık olduğunu kontrol et.</p><a class='xp-btn primary' href='nubbo://retry'>Yeniden Dene</a><a class='xp-btn' href='nubbo://computers'>Bilgisayarlar</a>"));}

 });LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);l.addView(web,new LinearLayout.LayoutParams(-1,-1));setContentView(l);insets(l);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);web.loadUrl(url);}
 @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);if(request==7&&grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED)showScanner();}
 private void showScanner(){releaseCamera();scanning=true;LinearLayout l=panel("PC’nin QR kodunu okut");text(l,"Nubbo → Tablet İzleme ekranındaki kodu kameraya göster.");SurfaceView surface=new SurfaceView(this);l.addView(surface,new LinearLayout.LayoutParams(-1,Math.min(dp(320),getResources().getDisplayMetrics().heightPixels/2)));button(l,"Geri",()->showConnections());surface.getHolder().addCallback(new SurfaceHolder.Callback(){public void surfaceCreated(SurfaceHolder h){try{camera=Camera.open();Camera.Parameters p=camera.getParameters();Camera.Size best=null;for(Camera.Size s:p.getSupportedPreviewSizes())if(s.width<=800&&(best==null||s.width>best.width))best=s;if(best!=null)p.setPreviewSize(best.width,best.height);p.setPreviewFormat(ImageFormat.NV21);if(p.getSupportedFocusModes().contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE))p.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);camera.setParameters(p);Camera.CameraInfo info=new Camera.CameraInfo();Camera.getCameraInfo(0,info);int rot=getWindowManager().getDefaultDisplay().getRotation()*90;camera.setDisplayOrientation((info.orientation-rot+360)%360);camera.setPreviewDisplay(h);camera.setPreviewCallback((bytes,c)->scanFrame(bytes,c));camera.startPreview();}catch(Exception e){releaseCamera();Toast.makeText(MainActivity.this,"Kamera açılamadı; bağlantıyı yapıştırabilirsin.",Toast.LENGTH_LONG).show();showConnections();}}public void surfaceChanged(SurfaceHolder h,int f,int w,int t){}public void surfaceDestroyed(SurfaceHolder h){releaseCamera();}});}
 private void scanFrame(byte[] data,Camera c){if(!scanning||SystemClock.elapsedRealtime()-lastScan<250||!decoding.compareAndSet(false,true))return;lastScan=SystemClock.elapsedRealtime();Camera.Size s=c.getParameters().getPreviewSize();byte[] frame=data.clone();decoder.execute(()->{try{MultiFormatReader reader=new MultiFormatReader();Map<DecodeHintType,Object> hints=new EnumMap<>(DecodeHintType.class);hints.put(DecodeHintType.POSSIBLE_FORMATS,Collections.singletonList(BarcodeFormat.QR_CODE));reader.setHints(hints);Result result;try{result=reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(new PlanarYUVLuminanceSource(frame,s.width,s.height,0,0,s.width,s.height,false))));}catch(NotFoundException e){byte[] rotated=new byte[s.width*s.height];for(int y=0;y<s.height;y++)for(int x=0;x<s.width;x++)rotated[x*s.height+s.height-1-y]=frame[y*s.width+x];reader.reset();result=reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(new PlanarYUVLuminanceSource(rotated,s.height,s.width,0,0,s.height,s.width,false))));}final String value=result.getText();if(valid(value))runOnUiThread(()->{if(scanning)open(value);});}catch(Exception ignored){}finally{decoding.set(false);}});}
 private void releaseCamera(){if(camera!=null){try{camera.setPreviewCallback(null);camera.stopPreview();}catch(Exception ignored){}camera.release();camera=null;}}
 @Override public void onBackPressed(){showConnections();}
 @Override protected void onPause(){super.onPause();releaseCamera();if(web!=null)web.onPause();}
 @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();else if(scanning)showScanner();}
 @Override public void onConfigurationChanged(Configuration c){super.onConfigurationChanged(c);if(scanning)showScanner();}
 @Override protected void onDestroy(){releaseCamera();decoder.shutdown();if(web!=null)web.destroy();super.onDestroy();}
}
