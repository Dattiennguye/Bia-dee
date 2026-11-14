package vn.vigo.billiardsparty;

import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

/**
 * Toàn màn hình thật sự: vẽ dưới tai thỏ/khuyết, ẩn thanh hệ thống, ưu tiên tần số quét cao nhất (90/120 Hz).
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    Window w = getWindow();
    w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    WindowManager.LayoutParams lp = w.getAttributes();
    if (Build.VERSION.SDK_INT >= 28) {
      lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
    }
    if (Build.VERSION.SDK_INT >= 23) {
      Display d = getWindowManager().getDefaultDisplay();
      Display.Mode cur = d.getMode();
      Display.Mode best = cur;
      for (Display.Mode m : d.getSupportedModes()) {
        if (m.getPhysicalWidth() == cur.getPhysicalWidth()
            && m.getPhysicalHeight() == cur.getPhysicalHeight()
            && m.getRefreshRate() > best.getRefreshRate()) {
          best = m;
        }
      }
      lp.preferredDisplayModeId = best.getModeId();
    }
    w.setAttributes(lp);
    hideSystemUi();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideSystemUi();
  }

  private void hideSystemUi() {
    View v = getWindow().getDecorView();
    v.setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
  }
}
