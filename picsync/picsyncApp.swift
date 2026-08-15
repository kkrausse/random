import SwiftUI

@main
struct picsyncApp: App {
    init() {
        AppLog.write("[App] launched")
    }

    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
