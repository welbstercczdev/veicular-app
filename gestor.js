// Dentro de gestor.js

function onQuadraClick(e) {
    const layer = e.target;
    const id = getQuadraId(layer.feature);
    const areaId = getAreaId(layer.feature);
    if (id === null || areaId === null) return;
    
    const compositeKey = `${areaId}-${id}`;

    if (selectedQuadras.has(compositeKey)) {
        selectedQuadras.delete(compositeKey);
    } else {
        let areaInSqMeters = 0;
        
        // --- INÍCIO DA NOVA LÓGICA DE CÁLCULO ---
        // Função para calcular a área de um único polígono
        const calculatePolygonArea = (latlngs) => {
            let area = 0;
            if (latlngs && latlngs.length > 2) {
                // Transforma as coordenadas de lat/lng para pontos no plano do mapa (em pixels/metros)
                const points = latlngs.map(latlng => map.project(latlng, map.getMaxZoom()));
                
                // Algoritmo "shoelace" para calcular a área de um polígono
                for (let i = 0; i < points.length; i++) {
                    const p1 = points[i];
                    const p2 = points[(i + 1) % points.length];
                    area += (p1.x * p2.y) - (p2.x * p1.y);
                }
                area = Math.abs(area / 2);
            }
            return area;
        };

        const latlngs = layer.getLatLngs();
        const geometryType = layer.feature.geometry.type;

        if (geometryType === 'Polygon') {
            // Se for Polygon, latlngs é [ [ponto1, ponto2, ...], [buraco1], ... ]
            areaInSqMeters = calculatePolygonArea(latlngs[0]);
        } else if (geometryType === 'MultiPolygon') {
            // Se for MultiPolygon, latlngs é [ [ [pontoA1, pontoA2, ...] ], [ [pontoB1, pontoB2, ...] ] ]
            latlngs.forEach(polygon => {
                areaInSqMeters += calculatePolygonArea(polygon[0]);
            });
        }
        // --- FIM DA NOVA LÓGICA DE CÁLCULO ---

        selectedQuadras.set(compositeKey, { id: id, area: areaId, sqMeters: areaInSqMeters });
    }
    
    layer.setStyle(getStyleForFeature(layer.feature));
    updateSidebar();
}
