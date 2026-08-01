/**
 * LiveActivityPlugin.swift
 *
 * Reference Capacitor plugin bridge for iOS.
 * Copy into your Xcode App target and register in the Capacitor bridge.
 */

import Capacitor
import ActivityKit
import Foundation

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startLiveActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateLiveActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endLiveActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getActiveActivities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cleanupStaleActivities", returnType: CAPPluginReturnPromise),
    ]

    /// Active push-token observation tasks keyed by entityId
    private var tokenTasks: [String: Task<Void, Never>] = [:]

    override public func load() {
        print("✅ LiveActivityPlugin loaded — Capacitor bridge registered")
    }

    // MARK: - Build ContentState from call

    private func buildState(from call: CAPPluginCall) -> LiveDeliveryAttributes.ContentState {
        return LiveDeliveryAttributes.ContentState(
            workflowStatus: call.getString("workflow_status") ?? "",
            etaMinutes: call.getInt("eta_minutes"),
            driverDistance: call.getDouble("driver_distance"),
            driverName: call.getString("driver_name"),
            vehicleType: call.getString("vehicle_type"),
            progressStage: call.getString("progress_stage"),
            progressPercent: call.getDouble("progress_percent"),
            sellerName: call.getString("seller_name"),
            itemCount: call.getInt("item_count"),
            orderShortId: call.getString("order_short_id"),
            sellerLogoUrl: call.getString("seller_logo_url")
        )
    }

    // MARK: - Start

    @objc func startLiveActivity(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                call.reject("Live Activities not enabled")
                return
            }

            let entityId = call.getString("entity_id") ?? ""
            let state = buildState(from: call)

            // Dedup: update existing activity with same entityId
            for activity in Activity<LiveDeliveryAttributes>.activities {
                if activity.attributes.entityId == entityId {
                    Task {
                        await activity.update(.init(state: state, staleDate: nil))
                        self.observePushToken(for: activity, entityId: entityId)
                        call.resolve(["activityId": activity.id])
                    }
                    return
                }
            }

            let attributes = LiveDeliveryAttributes(
                entityType: call.getString("entity_type") ?? "order",
                entityId: entityId
            )

            do {
                let activity = try Activity.request(
                    attributes: attributes,
                    content: .init(state: state, staleDate: nil),
                    pushType: .token
                )
                self.observePushToken(for: activity, entityId: entityId)
                call.resolve(["activityId": activity.id])
            } catch {
                call.reject("Failed to start live activity: \(error.localizedDescription)")
            }
        } else {
            call.reject("iOS 16.2+ required for Live Activities")
        }
    }

    // MARK: - Push Token Observation

    @available(iOS 16.2, *)
    private func observePushToken(for activity: Activity<LiveDeliveryAttributes>, entityId: String) {
        tokenTasks[entityId]?.cancel()

        let task = Task { [weak self] in
            for await tokenData in activity.pushTokenUpdates {
                guard !Task.isCancelled else { break }
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                print("📲 LiveActivity push token for \(entityId): \(token.prefix(16))…")

                self?.notifyListeners("liveActivityPushToken", data: [
                    "entityId": entityId,
                    "pushToken": token,
                ])
            }
        }
        tokenTasks[entityId] = task
    }

    // MARK: - Update

    @objc func updateLiveActivity(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            let entityId = call.getString("entity_id") ?? ""
            let state = buildState(from: call)

            Task {
                for activity in Activity<LiveDeliveryAttributes>.activities {
                    if activity.attributes.entityId == entityId {
                        await activity.update(.init(state: state, staleDate: nil))
                        call.resolve()
                        return
                    }
                }
                call.resolve()
            }
        } else {
            call.reject("iOS 16.2+ required for Live Activities")
        }
    }

    // MARK: - End

    @objc func endLiveActivity(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            let activityId = call.getString("activityId") ?? ""

            Task {
                for activity in Activity<LiveDeliveryAttributes>.activities {
                    if activity.id == activityId {
                        let entityId = activity.attributes.entityId
                        self.tokenTasks[entityId]?.cancel()
                        self.tokenTasks.removeValue(forKey: entityId)

                        await activity.end(
                            .init(state: activity.content.state, staleDate: nil),
                            dismissalPolicy: .immediate
                        )
                        break
                    }
                }
                call.resolve()
            }
        } else {
            call.reject("iOS 16.2+ required for Live Activities")
        }
    }

    // MARK: - Get Active Activities

    @objc func getActiveActivities(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            var result: [[String: String]] = []
            for activity in Activity<LiveDeliveryAttributes>.activities {
                result.append([
                    "activityId": activity.id,
                    "entityId": activity.attributes.entityId,
                ])
            }
            call.resolve(["activities": result])
        } else {
            call.resolve(["activities": []])
        }
    }

    // MARK: - Cleanup Stale Activities

    @objc func cleanupStaleActivities(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            let validIds = call.getArray("validEntityIds", String.self) ?? []
            Task {
                for activity in Activity<LiveDeliveryAttributes>.activities {
                    if !validIds.contains(activity.attributes.entityId) {
                        let entityId = activity.attributes.entityId
                        self.tokenTasks[entityId]?.cancel()
                        self.tokenTasks.removeValue(forKey: entityId)

                        await activity.end(
                            .init(state: activity.content.state, staleDate: nil),
                            dismissalPolicy: .immediate
                        )
                    }
                }
                call.resolve()
            }
        } else {
            call.resolve()
        }
    }
}
