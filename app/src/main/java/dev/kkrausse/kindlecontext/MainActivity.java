package dev.example.kindlecontext;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

public class MainActivity extends Activity {
    private TextView statusView;
    private TextView currentTextView;
    private TextView previousTextView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        acceptSharedText(getIntent());

        int space = dp(20);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(space, space, space, space);
        content.setBackgroundColor(Color.WHITE);

        TextView title = label(getString(R.string.title), 24, true);
        content.addView(title);

        TextView explanation = label(getString(R.string.explanation), 16, false);
        explanation.setTextColor(Color.DKGRAY);
        explanation.setPadding(0, dp(12), 0, dp(16));
        content.addView(explanation);

        statusView = label("", 16, false);
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

        content.addView(sectionLabel(getString(R.string.current_text)));
        currentTextView = textContent();
        content.addView(currentTextView);

        content.addView(sectionLabel(getString(R.string.previous_text)));
        previousTextView = textContent();
        content.addView(previousTextView);

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
        String enabled = Settings.Secure.getString(
                getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        statusView.setText(enabled != null && enabled.contains(getPackageName())
                ? R.string.service_enabled
                : R.string.service_disabled);

        currentTextView.setText(readText(KindleAccessibilityService.CURRENT_TEXT_KEY));
        previousTextView.setText(readText(KindleAccessibilityService.PREVIOUS_TEXT_KEY));
    }

    private String readText(String key) {
        String text = getSharedPreferences(KindleAccessibilityService.PREFS, MODE_PRIVATE)
                .getString(key, "");
        return TextUtils.isEmpty(text) ? getString(R.string.no_capture) : text;
    }

    private void acceptSharedText(Intent intent) {
        CharSequence selected;
        if (Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())) {
            selected = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        } else if (Intent.ACTION_SEND.equals(intent.getAction())
                && "text/plain".equals(intent.getType())) {
            selected = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        } else {
            return;
        }
        if (!TextUtils.isEmpty(selected)) {
            String current = getSharedPreferences(KindleAccessibilityService.PREFS, MODE_PRIVATE)
                    .getString(KindleAccessibilityService.CURRENT_TEXT_KEY, "");
            getSharedPreferences(KindleAccessibilityService.PREFS, MODE_PRIVATE)
                    .edit()
                    .putString(KindleAccessibilityService.PREVIOUS_TEXT_KEY, current)
                    .putString(KindleAccessibilityService.CURRENT_TEXT_KEY, selected.toString())
                    .apply();
        }
    }

    private TextView label(String text, int size, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.BLACK);
        view.setTextSize(size);
        if (bold) {
            view.setTypeface(null, Typeface.BOLD);
        }
        return view;
    }

    private TextView sectionLabel(String text) {
        TextView view = label(text, 16, true);
        view.setPadding(0, dp(20), 0, dp(8));
        return view;
    }

    private TextView textContent() {
        TextView view = label("", 17, false);
        view.setTextIsSelectable(true);
        return view;
    }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
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
