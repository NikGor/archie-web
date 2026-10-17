// Map component - renders a Map UI item (Leaflet + OpenStreetMap tiles, no API key needed)

const escapeMapHtml = (value) => {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
};

const ChatMapComponent = ({ map }) => {
    const { useEffect, useRef } = React;
    const containerRef = useRef(null);
    const mapInstanceRef = useRef(null);

    useEffect(() => {
        if (!containerRef.current || typeof L === 'undefined') {
            console.log('MapComponent: container ref not ready or Leaflet not loaded');
            return;
        }

        if (mapInstanceRef.current) {
            mapInstanceRef.current.remove();
            mapInstanceRef.current = null;
        }

        const points = (map.points || []).filter(
            (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
        );
        if (points.length === 0) {
            console.log('MapComponent: no valid points to render');
            return;
        }

        // Wheel zoom on directly, so scrolling over the map zooms it like any
        // embedded map. (Move the cursor off the map to scroll the conversation.)
        const leafletMap = L.map(containerRef.current, {
            scrollWheelZoom: true
        });

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 19
        }).addTo(leafletMap);

        points.forEach((point) => {
            const popupLines = [`<strong>${escapeMapHtml(point.title)}</strong>`];
            if (point.description) popupLines.push(escapeMapHtml(point.description));
            if (point.address) {
                popupLines.push(`<span style="opacity:0.7">${escapeMapHtml(point.address)}</span>`);
            }
            L.marker([point.lat, point.lng])
                .addTo(leafletMap)
                .bindPopup(popupLines.join('<br>'));
        });

        if (points.length === 1) {
            leafletMap.setView([points[0].lat, points[0].lng], 14);
        } else {
            const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
            leafletMap.fitBounds(bounds, { padding: [30, 30] });
        }

        mapInstanceRef.current = leafletMap;

        return () => {
            leafletMap.remove();
            mapInstanceRef.current = null;
        };
    }, [map]);

    return React.createElement('div', {
        className: 'backdrop-blur-lg bg-white/10 rounded-xl shadow-2xl p-4 border border-white/20 mb-4'
    }, [
        map.title && React.createElement('h3', {
            key: 'map-title',
            className: 'text-lg font-semibold text-white mb-3'
        }, map.title),
        React.createElement('div', {
            key: 'map-container',
            ref: containerRef,
            className: 'rounded-lg overflow-hidden',
            style: { height: `${map.height || 350}px`, width: '100%' }
        })
    ]);
};
