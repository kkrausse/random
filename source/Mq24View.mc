import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.WatchUi;

class Mq24View extends WatchUi.WatchFace {
    private const DIAL_COLOR = 0xfff8df;
    private const INK_COLOR = 0x151515;
    private const SECOND_COLOR = 0xc62026;

    private var _awake = true;
    private var _background;
    private var _dialLogo;
    private var _waterResist;
    private var _fullRefresh = true;

    public function initialize() {
        WatchFace.initialize();
    }

    public function onLayout(dc as Dc) as Void {
        _background = Graphics.createBufferedBitmap({
            :width => dc.getWidth(),
            :height => dc.getHeight()
        }).get();
        _dialLogo = WatchUi.loadResource(Rez.Drawables.DialLogo);
        _waterResist = WatchUi.loadResource(Rez.Drawables.WaterResist);
    }

    public function onUpdate(dc as Dc) as Void {
        _fullRefresh = true;
        drawFace(_background.getDc());
        dc.clearClip();
        dc.drawBitmap(0, 0, _background);

        if (_awake) {
            drawSecondHand(dc);
        }
        _fullRefresh = false;
    }

    public function onPartialUpdate(dc as Dc) as Void {
        if (!_awake) {
            return;
        }

        if (!_fullRefresh) {
            dc.drawBitmap(0, 0, _background);
        }
        drawSecondHand(dc);
    }

    public function onEnterSleep() as Void {
        _awake = false;
        WatchUi.requestUpdate();
    }

    public function onExitSleep() as Void {
        _awake = true;
        WatchUi.requestUpdate();
    }

    private function drawFace(dc as Dc) as Void {
        var width = dc.getWidth();
        var height = dc.getHeight();
        var cx = width / 2;
        var cy = height / 2;
        var radius = width / 2;
        var time = System.getClockTime();

        if (_awake) {
            dc.setColor(DIAL_COLOR, DIAL_COLOR);
            dc.fillRectangle(0, 0, width, height);
            dc.setColor(INK_COLOR, Graphics.COLOR_TRANSPARENT);
        } else {
            dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
            dc.fillRectangle(0, 0, width, height);
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        }

        for (var minute = 0; minute < 60; minute++) {
            var major = (minute % 5) == 0;
            var angle = (minute / 60.0) * Math.PI * 2 - Math.PI / 2;
            var outer = radius - 15;
            var inner = outer - (major ? 18 : 8);
            dc.setPenWidth(major ? 5 : 2);
            dc.drawLine(
                cx + inner * Math.cos(angle),
                cy + inner * Math.sin(angle),
                cx + outer * Math.cos(angle),
                cy + outer * Math.sin(angle)
            );
        }

        if (_awake) {
            dc.drawBitmap(cx - 35, cy - 84, _dialLogo);
            dc.drawBitmap(cx - 31, cy + 75, _waterResist);
        }

        var hour = ((time.hour % 12) + time.min / 60.0) / 12.0;
        var minute = (time.min + time.sec / 60.0) / 60.0;
        drawHand(dc, hour, radius * 0.47, radius * 0.08, 9);
        drawTaperedHand(dc, minute, radius * 0.84, radius * 0.09, 7);

        dc.setColor(_awake ? INK_COLOR : Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(cx, cy, 8);
    }

    private function drawHand(dc as Dc, fraction as Float, length as Numeric, tail as Numeric, width as Number) as Void {
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;
        var angle = fraction * Math.PI * 2 - Math.PI / 2;
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);

        dc.setPenWidth(width);
        dc.drawLine(
            cx - tail * cos,
            cy - tail * sin,
            cx + length * cos,
            cy + length * sin
        );
    }

    private function drawTaperedHand(dc as Dc, fraction as Float, length as Numeric, tail as Numeric, width as Number) as Void {
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;
        var angle = fraction * Math.PI * 2 - Math.PI / 2;
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        var halfWidth = width / 2.0;
        var tipWidth = 2.5;

        dc.fillPolygon([
            [cx - tail * cos, cy - tail * sin],
            [cx - halfWidth * sin, cy + halfWidth * cos],
            [cx + length * cos - tipWidth * sin, cy + length * sin + tipWidth * cos],
            [cx + length * cos + tipWidth * sin, cy + length * sin - tipWidth * cos],
            [cx + halfWidth * sin, cy - halfWidth * cos]
        ]);
    }

    private function drawSecondHand(dc as Dc) as Void {
        var time = System.getClockTime();
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;
        var radius = dc.getWidth() / 2;
        var angle = (time.sec / 60.0) * Math.PI * 2 - Math.PI / 2;
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);

        dc.setColor(SECOND_COLOR, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(2);
        dc.drawLine(
            cx - radius * 0.14 * cos,
            cy - radius * 0.14 * sin,
            cx + radius * 0.75 * cos,
            cy + radius * 0.75 * sin
        );
        dc.fillCircle(cx, cy, 4);
    }
}
