/**
 * NotificationServiceExtension.swift
 *
 * iOS Notification Service Extension (NSE) for rich push notifications.
 * Downloads and attaches images from `image_url` in the push payload
 * before the notification is displayed.
 *
 * Setup: Add a Notification Service Extension target in Xcode
 * (or via CI xcodeproj script) with this file as the principal class.
 */

import UserNotifications

class NotificationService: UNNotificationServiceExtension {

    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

        guard let bestAttemptContent = bestAttemptContent else {
            contentHandler(request.content)
            return
        }

        // Look for image_url in the push payload
        guard let imageUrlString = bestAttemptContent.userInfo["image_url"] as? String,
              let imageUrl = URL(string: imageUrlString) else {
            contentHandler(bestAttemptContent)
            return
        }

        // Download the image and attach it
        downloadImage(from: imageUrl) { attachment in
            if let attachment = attachment {
                bestAttemptContent.attachments = [attachment]
            }
            contentHandler(bestAttemptContent)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        // Deliver whatever we have when time runs out
        if let contentHandler = contentHandler,
           let bestAttemptContent = bestAttemptContent {
            contentHandler(bestAttemptContent)
        }
    }

    // MARK: - Image Download

    private func downloadImage(
        from url: URL,
        completion: @escaping (UNNotificationAttachment?) -> Void
    ) {
        let task = URLSession.shared.downloadTask(with: url) { localUrl, response, error in
            guard let localUrl = localUrl, error == nil else {
                completion(nil)
                return
            }

            // Determine file extension from response or URL
            let ext = self.fileExtension(from: response, url: url)
            let tmpDir = FileManager.default.temporaryDirectory
            let tmpFile = tmpDir.appendingPathComponent(UUID().uuidString + ext)

            do {
                try FileManager.default.moveItem(at: localUrl, to: tmpFile)
                let attachment = try UNNotificationAttachment(
                    identifier: "image",
                    url: tmpFile,
                    options: nil
                )
                completion(attachment)
            } catch {
                completion(nil)
            }
        }
        task.resume()
    }

    private func fileExtension(from response: URLResponse?, url: URL) -> String {
        if let mimeType = response?.mimeType {
            switch mimeType {
            case "image/jpeg": return ".jpg"
            case "image/png": return ".png"
            case "image/gif": return ".gif"
            case "image/webp": return ".webp"
            default: break
            }
        }

        let pathExt = url.pathExtension.lowercased()
        if !pathExt.isEmpty {
            return "." + pathExt
        }

        return ".jpg" // default
    }
}
