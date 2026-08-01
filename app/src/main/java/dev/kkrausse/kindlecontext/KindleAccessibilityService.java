package dev.example.kindlecontext;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.ColorSpace;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.hardware.HardwareBuffer;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Button;

import java.util.LinkedHashSet;
import java.util.Set;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class KindleAccessibilityService extends AccessibilityService {
    public static final String KINDLE_PACKAGE = "com.amazon.kindle";
    public static final String PREFS = "capture";
    public static final String CAPTURE_KEY = "latest_text";
    public static final String IMAGE_FILE = "kindle-page.png";

    private WindowManager windowManager;
    private Button askButton;
    private ExecutorService screenshotExecutor;

    @Override
    protected void onServiceConnected() {
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        screenshotExecutor = Executors.newSingleThreadExecutor();
        askButton = new Button(this);
        askButton.setText(R.string.ask);
        askButton.setTextSize(15);

        GradientDrawable background = new GradientDrawable();
        background.setColor(0xff111111);
        background.setCornerRadius(dp(8));
        askButton.setTextColor(0xffffffff);
        askButton.setBackground(background);
        askButton.setOnClickListener(v -> {
            captureCurrentTree();
            captureScreenshot();
        });

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                dp(76),
                dp(52),
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.END | Gravity.CENTER_VERTICAL;
        params.x = dp(12);
        windowManager.addView(askButton, params);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        CharSequence packageName = event.getPackageName();
        boolean isKindle = packageName != null && KINDLE_PACKAGE.contentEquals(packageName);
        if (!isKindle) {
            return;
        }

        captureCurrentTree();
    }

    private int collectText(AccessibilityNodeInfo node, Set<String> pieces) {
        int count = 1;
        CharSequence text = node.getText();
        if (text != null && !text.toString().trim().isEmpty()) {
            pieces.add(text.toString().trim());
        }

        CharSequence description = node.getContentDescription();
        if (description != null && !description.toString().trim().isEmpty()) {
            pieces.add(description.toString().trim());
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                count += collectText(child, pieces);
            }
        }
        return count;
    }

    @Override
    public void onInterrupt() {
    }

    private void captureScreenshot() {
        askButton.setEnabled(false);
        askButton.setText(R.string.capturing);
        takeScreenshot(Display.DEFAULT_DISPLAY, screenshotExecutor, new TakeScreenshotCallback() {
            @Override
            public void onSuccess(ScreenshotResult screenshot) {
                HardwareBuffer buffer = screenshot.getHardwareBuffer();
                ColorSpace colorSpace = screenshot.getColorSpace();
                Bitmap hardwareBitmap = Bitmap.wrapHardwareBuffer(buffer, colorSpace);
                Bitmap bitmap = hardwareBitmap == null
                        ? null
                        : hardwareBitmap.copy(Bitmap.Config.ARGB_8888, false);
                buffer.close();

                if (bitmap == null) {
                    finishScreenshot("Screenshot failed: Android returned no readable image.");
                    return;
                }

                try (FileOutputStream output = new FileOutputStream(new File(getFilesDir(), IMAGE_FILE))) {
                    if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
                        throw new IOException("PNG encoding failed");
                    }
                    finishScreenshot("Screenshot captured locally. Kindle still exposed only the accessibility text shown below.");
                } catch (IOException error) {
                    finishScreenshot("Screenshot save failed: " + error.getMessage());
                } finally {
                    bitmap.recycle();
                }
            }

            @Override
            public void onFailure(int errorCode) {
                finishScreenshot("Screenshot blocked or failed (Android error " + errorCode + ").");
            }
        });
    }

    private void finishScreenshot(String status) {
        String accessibilityText = getSharedPreferences(PREFS, MODE_PRIVATE)
                .getString(CAPTURE_KEY, "");
        getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putString(CAPTURE_KEY, status + "\n\nAccessibility text:\n" + accessibilityText)
                .apply();

        getMainExecutor().execute(() -> {
            askButton.setText(R.string.ask);
            askButton.setEnabled(true);
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(intent);
        });
    }

    private void captureCurrentTree() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        Set<String> pieces = new LinkedHashSet<>();
        int nodeCount = root == null ? 0 : collectText(root, pieces);
        String text = String.join("\n\n", pieces).trim();
        if (text.isEmpty()) {
            String rootClass = root == null ? "none" : String.valueOf(root.getClassName());
            text = "No accessibility text was exposed by Kindle.\n\n"
                    + "Nodes inspected: " + nodeCount + "\n"
                    + "Root class: " + rootClass;
        }
        getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putString(CAPTURE_KEY, text)
                .apply();
    }

    @Override
    public void onDestroy() {
        if (windowManager != null && askButton != null) {
            windowManager.removeView(askButton);
        }
        if (screenshotExecutor != null) {
            screenshotExecutor.shutdownNow();
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
