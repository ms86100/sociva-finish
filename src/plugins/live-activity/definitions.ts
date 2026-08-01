/**
 * Capacitor Plugin: LiveActivity
 *
 * Bridge between the Sociva web layer and native iOS (ActivityKit) /
 * Android (Foreground Service) lock-screen live activities.
 */

export interface LiveActivityData {
  /** Discriminator: "order" | "booking" */
  entity_type: string;
  /** UUID of the order or booking */
  entity_id: string;
  /** Current workflow status key */
  workflow_status: string;
  /** Estimated time of arrival in minutes (null if unknown) */
  eta_minutes: number | null;
  /** Distance to destination in kilometres (null if unknown) */
  driver_distance: number | null;
  /** Rider / driver display name */
  driver_name: string | null;
  /** Vehicle type label, e.g. "Bike", "Car" */
  vehicle_type: string | null;
  /** Human-readable progress stage, e.g. "Preparing → Picked Up → On the way" */
  progress_stage: string | null;
  /** 0.0–1.0 progress percentage for the animated bar */
  progress_percent: number | null;
  /** Seller / business display name */
  seller_name: string | null;
  /** Number of items in the order */
  item_count: number | null;
  /** Short order identifier for buyer recognition, e.g. "#7838" */
  order_short_id: string | null;
  /** Seller logo URL for branded display */
  seller_logo_url: string | null;
}

export interface ActiveActivityEntry {
  activityId: string;
  entityId: string;
}

export interface LiveActivityPlugin {
  startLiveActivity(data: LiveActivityData): Promise<{ activityId: string }>;
  updateLiveActivity(data: LiveActivityData): Promise<void>;
  endLiveActivity(opts: { activityId: string }): Promise<void>;
  getActiveActivities(): Promise<{ activities: ActiveActivityEntry[] }>;
  cleanupStaleActivities(opts: { validEntityIds: string[] }): Promise<void>;
  addListener?(eventName: string, callback: (data: any) => void): any;
}
