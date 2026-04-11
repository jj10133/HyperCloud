import BareKit
import BareRPC
import Foundation

// IPCBridge owns the BareKit Worklet and wires it to bare-rpc.
// Conforms to RPCDelegate so RPC can send/receive frames over BareKit IPC.

final class IPCBridge: NSObject {

    let rpc: RPC

    private let worklet:   Worklet
    private let _delegate: _IPCDelegate

    // Callbacks wired up by Worker
    var onEvent:   ((IncomingEvent)   -> Void)?
    var onRequest: ((IncomingRequest) -> Void)?
    var onError:   ((Error)           -> Void)?

    override init() {
        worklet = Worklet()
        worklet.start(name: "app", ofType: "bundle")

        let ipc      = IPC(worklet: worklet)
        let delegate = _IPCDelegate(ipc: ipc)
        let rpc      = RPC(delegate: delegate)
        delegate.rpc = rpc

        self._delegate = delegate
        self.rpc       = rpc

        super.init()

        delegate.onEvent   = { [weak self] e   in self?.onEvent?(e) }
        delegate.onRequest = { [weak self] req in self?.onRequest?(req) }
        delegate.onError   = { [weak self] err in self?.onError?(err) }
    }

    func start() async {
        await _delegate.readLoop()
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

// MARK: - Private delegate

private final class _IPCDelegate: RPCDelegate {
    private let ipc: IPC
    unowned var rpc: RPC!

    var onEvent:   ((IncomingEvent)   -> Void)?
    var onRequest: ((IncomingRequest) -> Void)?
    var onError:   ((Error)           -> Void)?

    init(ipc: IPC) { self.ipc = ipc }

    func rpc(_ rpc: RPC, send data: Data) {
        Task {
            do { try await ipc.write(data: data) }
            catch { print("[drift] IPC write error: \(error)") }
        }
    }

    func rpc(_ rpc: RPC, didReceiveRequest request: IncomingRequest) async throws {
        onRequest?(request)
    }

    func rpc(_ rpc: RPC, didReceiveEvent event: IncomingEvent) async {
        onEvent?(event)
    }

    func rpc(_ rpc: RPC, didFailWith error: Error) {
        onError?(error)
    }

    func readLoop() async {
        do {
            for try await chunk in ipc { rpc.receive(chunk) }
        } catch {
            print("[drift] IPC read error: \(error)")
        }
    }
}
