from django.urls import path

from . import views

urlpatterns = [
    path("api/conversations/", views.proxy_conversations, name="proxy_conversations"),
    path(
        "api/conversations/<str:conversation_id>/",
        views.proxy_conversation_detail,
        name="proxy_conversation_detail",
    ),
    path(
        "api/conversations/<str:conversation_id>/messages/",
        views.proxy_conversation_messages,
        name="proxy_conversation_messages",
    ),
    path(
        "api/conversations/<str:conversation_id>/regenerate-title/",
        views.regenerate_title,
        name="regenerate_title",
    ),
    path("api/messages/", views.proxy_send_message, name="proxy_send_message"),
    path("api/chat/", views.proxy_chat, name="proxy_chat"),
    path("api/generate-title/", views.generate_title, name="generate_title"),
    path("api/process-images/", views.process_images, name="process_images"),
    path("api/save-message/", views.save_message, name="save_message"),
    path("api/tts/", views.synth_speech, name="synth_speech"),
    path("api/live-token/", views.live_token, name="live_token"),
    path(
        "api/messages/<str:message_id>/audio/",
        views.message_audio,
        name="message_audio",
    ),
    path(
        "api/messages/<str:message_id>/images/",
        views.message_images,
        name="message_images",
    ),
    path(
        "api/messages/<str:message_id>/files/",
        views.message_files,
        name="message_files",
    ),
    path(
        "api/messages/<str:message_id>/files/<int:position>/",
        views.message_file,
        name="message_file",
    ),
    path(
        "api/messages/<str:message_id>/images/<int:position>/",
        views.message_image,
        name="message_image",
    ),
]
