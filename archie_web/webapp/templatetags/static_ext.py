"""Static tag with a cache-busting version query.

On the Pi, DEBUG=True serves static files with stable, unhashed URLs, so browsers
cache JS/CSS "forever" and miss deploys until a manual hard reload. `static_v`
appends ?v=<STATIC_VERSION>, which changes every deploy (the container restarts),
so browsers fetch fresh assets automatically.
"""

from django import template
from django.conf import settings
from django.templatetags.static import static as static_url

register = template.Library()


@register.simple_tag
def static_v(path):
    url = static_url(path)
    version = getattr(settings, "STATIC_VERSION", "")
    if not version:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}v={version}"
