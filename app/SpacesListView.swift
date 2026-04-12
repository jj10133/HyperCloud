//
//  SpacesListView.swift
//  App
//
//  Created by Janardhan on 2026-04-11.
//


import SwiftUI

struct SpacesListView: View {
    @EnvironmentObject var worker: Worker
    @Binding var route: MenuBarView.Route

    var body: some View {
        VStack(spacing: 0) {

            // ── Header ───────────────────────────────────────────────────────
            HStack {
                Text("HyperCloud")
                    .font(.headline)
                Spacer()
                Circle()
                    .fill(worker.ready ? Color.green : Color.orange)
                    .frame(width: 8, height: 8)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider()

            // ── Spaces ───────────────────────────────────────────────────────
            if worker.spaces.isEmpty {
                VStack(spacing: 6) {
                    Text("No spaces yet")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    Text("Create one to start syncing")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 28)
            } else {
                VStack(spacing: 0) {
                    ForEach(worker.spaces) { space in
                        SpaceRow(space: space)
                            .contentShape(Rectangle())
                            .onTapGesture { route = .spaceDetail(space) }

                        if space.id != worker.spaces.last?.id {
                            Divider().padding(.leading, 16)
                        }
                    }
                }
            }

            Divider()

            // ── Footer actions ───────────────────────────────────────────────
            VStack(spacing: 0) {
                FooterAction(label: "New space", icon: "plus") {
                    route = .newSpace
                }
                FooterAction(label: "Quit", icon: "power", role: .destructive) {
                    NSApplication.shared.terminate(nil)
                }
            }
            .padding(.vertical, 4)
        }
        .onAppear {
            worker.loadSpaces()
        }
    }
}

// ── Space row ─────────────────────────────────────────────────────────────────

struct SpaceRow: View {
    let space: Space

    var body: some View {
        HStack(spacing: 10) {
            // status dot
            Circle()
                .fill(dotColor)
                .frame(width: 7, height: 7)

            VStack(alignment: .leading, spacing: 2) {
                Text(space.name)
                    .font(.system(size: 13, weight: .medium))
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var dotColor: Color {
        if space.paused { return .orange }
        return space.peers > 0 ? .green : .secondary
    }

    private var subtitle: String {
        if space.paused { return "paused" }
        if space.peers == 0 { return "no peers" }
        return "\(space.peers) peer\(space.peers == 1 ? "" : "s")"
    }
}

// ── Footer action row ─────────────────────────────────────────────────────────

struct FooterAction: View {
    let label: String
    let icon: String
    var role: ButtonRole? = nil
    let action: () -> Void

    var body: some View {
        Button(role: role, action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .frame(width: 16)
                Text(label)
                Spacer()
            }
            .foregroundStyle(role == .destructive ? Color.red : Color.primary)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
