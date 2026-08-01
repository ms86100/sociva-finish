/**
 * LiveDeliveryActivity.swift
 * 
 * Reference implementation — copy into your Xcode project's
 * Widget Extension target.
 *
 * Defines the ActivityKit attributes for Sociva delivery/booking
 * live activities on iOS 16.1+.
 */

import ActivityKit
import Foundation

struct LiveDeliveryAttributes: ActivityAttributes {
    /// Dynamic context that updates during the activity
    struct ContentState: Codable, Hashable {
        var workflowStatus: String
        var etaMinutes: Int?
        var driverDistance: Double?
        var driverName: String?
        var vehicleType: String?
        var progressStage: String?
        var progressPercent: Double?
        var sellerName: String?
        var itemCount: Int?
        var orderShortId: String?
        var sellerLogoUrl: String?
    }

    /// Fixed data set at start
    var entityType: String   // "order" | "booking"
    var entityId: String
}
