import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

class Mq24App extends Application.AppBase {
    public function initialize() {
        AppBase.initialize();
    }

    public function getInitialView() as [Views] or [Views, InputDelegates] {
        return [new Mq24View()];
    }
}
