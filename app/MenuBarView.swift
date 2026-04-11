import SwiftUI

struct MenuBarView: View {
    @EnvironmentObject var worker: Worker
    @State private var route: Route = .spaces

    enum Route: Equatable {
        case spaces
        case newSpace
        case spaceDetail(Space)

        static func == (lhs: Route, rhs: Route) -> Bool {
            switch (lhs, rhs) {
            case (.spaces, .spaces): return true
            case (.newSpace, .newSpace): return true
            case (.spaceDetail(let a), .spaceDetail(let b)): return a.id == b.id
            default: return false
            }
        }
    }

    var body: some View {
        Group {
            switch route {
            case .spaces:
                SpacesListView(route: $route)
            case .newSpace:
                NewSpaceView(route: $route)
            case .spaceDetail(let space):
                SpaceDetailView(route: $route, space: space)
            }
        }
        .environmentObject(worker)
        .frame(width: 280)
        .animation(.easeInOut(duration: 0.15), value: route)
    }
}
