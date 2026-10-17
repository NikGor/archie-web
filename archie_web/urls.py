"""
URL configuration for archie-web project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("archie_web.webapp.urls")),
    path("api/", include("archie_web.api.urls")),
    path("camera/", include("archie_web.camera.urls")),
    path("light/", include("archie_web.light.urls")),
    path("climate/", include("archie_web.climate.urls")),
    path("weather/", include("archie_web.weather.urls")),
    path("ai-assistant/", include("archie_web.ai_assistant.urls")),
    path("voice/", include("archie_web.voice_assistant.urls")),
    path("spotify/", include("archie_web.spotify.urls")),
    path("prompt-evals/", include("archie_web.prompt_evals.urls")),
    path("chat-monitoring/", include("archie_web.chat_monitoring.urls")),
]
