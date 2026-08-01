package dev.example.kindlecontext;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.BitmapFactory;
import android.graphics.Typeface;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

public class MainActivity extends Activity {
    private TextView statusView;
    private TextView captureView;
    private ImageView screenshotView;
    private TextView screenshotEmptyView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        acceptSharedText(getIntent());

        int space = dp(20);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(space, space, space, space);
        content.setBackgroundColor(Color.WHITE);

        TextView title = new TextView(this);
        title.setText(R.string.title);
        title.setTextColor(Color.BLACK);
        title.setTextSize(24);
        title.setTypeface(null, Typeface.BOLD);
        content.addView(title);

        TextView explanation = new TextView(this);
        explanation.setText(R.string.explanation);
        explanation.setTextColor(Color.DKGRAY);
        explanation.setTextSize(16);
        explanation.setPadding(0, dp(12), 0, dp(16));
        content.addView(explanation);

        statusView = new TextView(this);
        statusView.setTextSize(16);
        statusView.setPadding(0, 0, 0, dp(12));
        content.addView(statusView);

        Button enableButton = button(getString(R.string.enable_service));
        enableButton.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        content.addView(enableButton);

        Button kindleButton = button(getString(R.string.open_kindle));
        kindleButton.setOnClickListener(v -> {
            Intent launch = getPackageManager().getLaunchIntentForPackage(KindleAccessibilityService.KINDLE_PACKAGE);
            if (launch != null) {
                startActivity(launch);
            } else {
                statusView.setText(R.string.kindle_not_found);
            }
        });
        content.addView(kindleButton);

        Button refreshButton = button(getString(R.string.refresh_capture));
        refreshButton.setOnClickListener(v -> refresh());
        content.addView(refreshButton);

        TextView screenshotLabel = new TextView(this);
        screenshotLabel.setText(R.string.screenshot_preview);
        screenshotLabel.setTextColor(Color.BLACK);
        screenshotLabel.setTypeface(null, Typeface.BOLD);
        screenshotLabel.setPadding(0, dp(20), 0, dp(8));
        content.addView(screenshotLabel);

        screenshotView = new ImageView(this);
        screenshotView.setAdjustViewBounds(true);
        screenshotView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        screenshotView.setContentDescription(getString(R.string.screenshot_preview));
        content.addView(screenshotView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));

        screenshotEmptyView = new TextView(this);
        screenshotEmptyView.setText(R.string.no_screenshot);
        screenshotEmptyView.setTextColor(Color.DKGRAY);
        content.addView(screenshotEmptyView);

        TextView captureLabel = new TextView(this);
        captureLabel.setText(R.string.latest_capture);
        captureLabel.setTextColor(Color.BLACK);
        captureLabel.setTypeface(null, Typeface.BOLD);
        captureLabel.setPadding(0, dp(20), 0, dp(8));
        content.addView(captureLabel);

        captureView = new TextView(this);
        captureView.setTextColor(Color.BLACK);
        captureView.setTextSize(17);
        captureView.setTextIsSelectable(true);
        content.addView(captureView);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(content);
        setContentView(scroll);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        acceptSharedText(intent);
        refresh();
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
    }

    private void refresh() {
        String enabled = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        boolean serviceEnabled = enabled != null && enabled.contains(getPackageName());
        statusView.setText(serviceEnabled ? R.string.service_enabled : R.string.service_disabled);

        String capture = getSharedPreferences(KindleAccessibilityService.PREFS, MODE_PRIVATE)
                .getString(KindleAccessibilityService.CAPTURE_KEY, "");
        captureView.setText(TextUtils.isEmpty(capture)
                ? getString(R.string.no_capture)
                : capture);

        java.io.File screenshot = new java.io.File(getFilesDir(), KindleAccessibilityService.IMAGE_FILE);
        if (screenshot.exists()) {
            screenshotView.setImageBitmap(BitmapFactory.decodeFile(screenshot.getAbsolutePath()));
            screenshotView.setVisibility(View.VISIBLE);
            screenshotEmptyView.setVisibility(View.GONE);
        } else {
            screenshotView.setImageDrawable(null);
            screenshotView.setVisibility(View.GONE);
            screenshotEmptyView.setVisibility(View.VISIBLE);
        }
    }

    private void acceptSharedText(Intent intent) {
        CharSequence selected;
        int message;
        if (Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())) {
            selected = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
            message = R.string.selected_text_received;
        } else if (Intent.ACTION_SEND.equals(intent.getAction())
                && "text/plain".equals(intent.getType())) {
            selected = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            message = R.string.shared_text_received;
        } else {
            return;
        }
        if (!TextUtils.isEmpty(selected)) {
            getSharedPreferences(KindleAccessibilityService.PREFS, MODE_PRIVATE)
                    .edit()
                    .putString(
                            KindleAccessibilityService.CAPTURE_KEY,
                            getString(message) + "\n\n" + selected)
                    .apply();
        }
    }

    private Button button(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(16);
        button.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, dp(8));
        button.setLayoutParams(params);
        return button;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
