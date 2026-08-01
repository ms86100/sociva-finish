/**
 * LiveDeliveryWidget.swift
 *
 * Unified, status-adaptive Live Activity widget for Sociva.
 * Single dark card with status-tinted accents, SF Symbols,
 * clean typography, and contextual information.
 */

import SwiftUI
import WidgetKit
import ActivityKit

// MARK: - Programmatic SV Badge

@available(iOS 16.1, *)
struct SocivaBadge: View {
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .fill(Color(white: 0.12))

            HStack(spacing: size * 0.02) {
                Text("S")
                    .font(.system(size: size * 0.48, weight: .heavy, design: .rounded))
                    .foregroundColor(.white)
                Text("V")
                    .font(.system(size: size * 0.48, weight: .heavy, design: .rounded))
                    .foregroundColor(Color(red: 0.2, green: 0.78, blue: 0.45))
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

// MARK: - Status Phase

@available(iOS 16.1, *)
enum OrderPhase {
    case confirmed
    case preparing
    case ready
    case transit
    case arrived
    case delivered

    var accentColor: Color {
        switch self {
        case .confirmed:  return .orange
        case .preparing:  return Color(red: 0.95, green: 0.65, blue: 0.15)
        case .ready:      return Color(red: 0.25, green: 0.55, blue: 0.95)
        case .transit:    return Color(red: 0.2, green: 0.78, blue: 0.45)
        case .arrived:    return Color(red: 0.2, green: 0.78, blue: 0.45)
        case .delivered:  return Color(red: 0.15, green: 0.75, blue: 0.5)
        }
    }

    var sfSymbol: String {
        switch self {
        case .confirmed:  return "checkmark.circle.fill"
        case .preparing:  return "fork.knife"
        case .ready:      return "bag.fill"
        case .transit:    return "bicycle"
        case .arrived:    return "mappin.and.ellipse"
        case .delivered:  return "checkmark.seal.fill"
        }
    }

    var title: String {
        switch self {
        case .confirmed:  return "Order Confirmed"
        case .preparing:  return "Being Prepared"
        case .ready:      return "Ready"
        case .transit:    return "On the Way"
        case .arrived:    return "At Your Location"
        case .delivered:  return "Delivered"
        }
    }

    static func from(_ status: String) -> OrderPhase {
        switch status {
        case "accepted", "confirmed":               return .confirmed
        case "preparing":                            return .preparing
        case "ready":                                return .ready
        case "picked_up", "on_the_way", "en_route":  return .transit
        case "arrived":                              return .arrived
        case "delivered", "completed":               return .delivered
        default:                                     return .confirmed
        }
    }
}

// MARK: - Accent Progress Bar

@available(iOS 16.1, *)
struct AccentProgressBar: View {
    let progress: Double
    let accentColor: Color
    let showScooter: Bool

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let p = min(max(progress, 0), 1)

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(accentColor.opacity(0.15))
                    .frame(height: 5)

                Capsule()
                    .fill(accentColor)
                    .frame(width: w * p, height: 5)
                    .animation(.easeInOut(duration: 0.6), value: p)

                if showScooter {
                    Text("🛵")
                        .font(.system(size: 14))
                        .offset(x: max(0, w * p - 9), y: -3)
                        .animation(.easeInOut(duration: 0.6), value: p)
                }
            }
        }
        .frame(height: 18)
    }
}

// MARK: - Widget

@available(iOS 16.1, *)
@main
struct LiveDeliveryWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LiveDeliveryAttributes.self) { context in
            lockScreenView(context: context)
                .widgetURL(URL(string: "sociva://orders/\(context.attributes.entityId)"))

        } dynamicIsland: { context in
            let phase = OrderPhase.from(context.state.workflowStatus)
            let displayTitle = context.state.progressStage ?? phase.title

            return DynamicIsland {
                // ── Expanded ──
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        SocivaBadge(size: 22)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(context.state.sellerName ?? "Sociva")
                                .font(.caption2)
                                .foregroundColor(.white.opacity(0.6))
                            HStack(spacing: 4) {
                                Image(systemName: phase.sfSymbol)
                                    .font(.caption2)
                                    .foregroundColor(phase.accentColor)
                                Text(displayTitle)
                                    .font(.caption)
                                    .fontWeight(.semibold)
                                    .foregroundColor(.white)
                            }
                        }
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let eta = context.state.etaMinutes {
                        VStack(alignment: .trailing, spacing: 1) {
                            Text("\(eta)")
                                .font(.title3)
                                .fontWeight(.bold)
                                .foregroundColor(phase.accentColor)
                            Text("min")
                                .font(.caption2)
                                .foregroundColor(.white.opacity(0.5))
                        }
                    } else if let shortId = context.state.orderShortId {
                        Text(shortId)
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.5))
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    AccentProgressBar(
                        progress: context.state.progressPercent ?? 0,
                        accentColor: phase.accentColor,
                        showScooter: phase == .transit
                    )
                    .padding(.horizontal, 4)
                    .padding(.top, 2)
                }
            } compactLeading: {
                SocivaBadge(size: 24)
            } compactTrailing: {
                if let eta = context.state.etaMinutes {
                    Text("\(eta)m")
                        .font(.caption)
                        .bold()
                        .foregroundColor(phase.accentColor)
                } else {
                    Circle()
                        .trim(from: 0, to: context.state.progressPercent ?? 0.1)
                        .stroke(phase.accentColor, lineWidth: 2)
                        .frame(width: 14, height: 14)
                        .rotationEffect(.degrees(-90))
                }
            } minimal: {
                SocivaBadge(size: 22)
            }
            .widgetURL(URL(string: "sociva://orders/\(context.attributes.entityId)"))
        }
    }

    // MARK: - Unified Lock Screen View

    @ViewBuilder
    private func lockScreenView(context: ActivityViewContext<LiveDeliveryAttributes>) -> some View {
        let phase = OrderPhase.from(context.state.workflowStatus)
        let displayTitle = context.state.progressStage ?? phase.title

        VStack(alignment: .leading, spacing: 10) {
            // ── Row 1: Brand + Order ID ──
            HStack {
                SocivaBadge(size: 24)

                Text(context.state.sellerName ?? "Sociva")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.white.opacity(0.85))

                Spacer()

                VStack(alignment: .trailing, spacing: 1) {
                    if let shortId = context.state.orderShortId {
                        Text(shortId)
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundColor(.white.opacity(0.5))
                    }
                    if let count = context.state.itemCount, count > 0 {
                        Text("\(count) item\(count == 1 ? "" : "s")")
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.4))
                    }
                }
            }

            // ── Row 2: Status Title with SF Symbol ──
            HStack(spacing: 6) {
                Image(systemName: phase.sfSymbol)
                    .font(.subheadline)
                    .foregroundColor(phase.accentColor)

                Text(displayTitle)
                    .font(.subheadline)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
            }

            // ── Row 3: Contextual Subtitle ──
            Text(contextualSubtitle(state: context.state, phase: phase))
                .font(.caption)
                .foregroundColor(.white.opacity(0.6))
                .lineLimit(1)

            // ── Row 4: Progress + ETA ──
            HStack(spacing: 8) {
                AccentProgressBar(
                    progress: context.state.progressPercent ?? 0,
                    accentColor: phase.accentColor,
                    showScooter: phase == .transit
                )

                if let eta = context.state.etaMinutes {
                    Text("ETA \(eta) min")
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .foregroundColor(phase.accentColor)
                        .fixedSize()
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(
            ZStack {
                Color(white: 0.1)
                phase.accentColor
                    .opacity(0.08)
                    .blur(radius: 40)
                    .offset(x: -60, y: -30)
            }
        )
    }

    // MARK: - Contextual Subtitle

    private func contextualSubtitle(state: LiveDeliveryAttributes.ContentState, phase: OrderPhase) -> String {
        switch phase {
        case .confirmed:
            return "Seller is reviewing your order"
        case .preparing:
            return state.progressStage ?? "Your order is being made"
        case .ready:
            if let seller = state.sellerName {
                return "Waiting to be picked up from \(seller)"
            }
            return "Your order is ready for pickup"
        case .transit:
            var parts: [String] = []
            if let name = state.driverName { parts.append(name) }
            if let dist = state.driverDistance { parts.append(String(format: "%.1f km away", dist)) }
            return parts.isEmpty ? "Your order is on the way" : parts.joined(separator: " · ")
        case .arrived:
            if let name = state.driverName {
                return "\(name) has arrived"
            }
            return "Your delivery has arrived"
        case .delivered:
            return "Thank you for your order"
        }
    }
}
