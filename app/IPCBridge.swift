import BareKit
import BareRPC
import Foundation

// IPCBridge owns the BareKit Worklet and wires it to bare-rpc.
// Only place in the app that touches raw IPC bytes.

final class IPCBridge {

    let rpc: RPC

    private let worklet:  Worklet
    private let delegate: _Delegate

    init() {
        worklet = Worklet()
        worklet.start(name: "app", ofType: "bundle")

        let ipc      = IPC(worklet: worklet)
        let delegate = _Delegate(ipc: ipc)
        let rpc      = RPC(delegate: delegate)
        delegate.rpc = rpc

        self.delegate = delegate
        self.rpc      = rpc
    }

    func start() async {
        await delegate.readLoop()
    }

    func request(_ command: UInt, body: [String: Any] = [:]) async throws -> [String: Any]? {
        let data = try JSONSerialization.data(withJSONObject: body)
        guard let raw = try await rpc.request(command, data: data) else { return nil }
        return try JSONSerialization.jsonObject(with: raw) as? [String: Any]
    }

    func suspend()   { worklet.suspend() }
    func resume()    { worklet.resume() }
    func terminate() { worklet.terminate() }
}

private final class _Delegate: RPCDelegate {
    private let ipc: IPC
    unowned var rpc: RPC!

    init(ipc: IPC) { self.ipc = ipc }

    func rpc(_ rpc: RPC, send data: Data) {
        Task {
            do { try await ipc.write(data: data) }
            catch { print("[drift] IPC write error: \(error)") }
        }
    }

    func readLoop() async {
        do {
            for try await chunk in ipc { rpc.receive(chunk) }
        } catch {
            print("[drift] IPC read error: \(error)")
        }
    }
}