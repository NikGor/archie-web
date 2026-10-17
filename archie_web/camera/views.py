# import cv2  # Temporarily disabled for Docker deployment
import json

from django.http import JsonResponse, StreamingHttpResponse
from django.shortcuts import render


def camera_view(request):
    """Render camera page"""
    return render(request, "camera/camera.html")


def video_feed(request):
    """Video streaming generator function - temporarily disabled"""
    from django.http import HttpResponse

    return HttpResponse(
        "Camera functionality temporarily disabled during Docker deployment",
        content_type="text/plain",
    )


def camera_api(request):
    """API endpoint for camera controls"""
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            action = data.get("action", "toggle")

            # Here you can implement camera controls like:
            # - Take snapshot
            # - Start/stop recording
            # - Change resolution
            # - Toggle flash (if available)

            return JsonResponse(
                {
                    "status": "success",
                    "action": action,
                    "message": f"Camera {action} executed",
                }
            )
        except Exception as e:
            return JsonResponse({"status": "error", "message": str(e)})

    return JsonResponse({"status": "error", "message": "Only POST method allowed"})
