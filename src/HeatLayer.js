'use strict';

L.HeatLayer = (L.Layer ? L.Layer : L.Class).extend({

    // options: {
    //     url: 'http://tile.sintrafico.com/raw/heatmap.csv?bbox={minX},{minY},{maxX},{maxY}&apiKey={key}',
    //     minOpacity: 0.05,
    //     maxZoom: 18,
    //     radius: 25,
    //     blur: 15,
    //     max: 1.0,
    //     gradient: {
    //         0.4: 'blue',
    //         0.6: 'cyan',
    //         0.7: 'lime',
    //         0.8: 'yellow',
    //         1.0: 'red'
    //     }
    // },

    initialize: function (options) {
        L.setOptions(this, options);
        console.log(this.options);
    },

    setLatLngs: function (latlngs) {
        this._latlngs = latlngs;
        return this.redraw();
    },

    addLatLng: function (latlng) {
        this._latlngs.push(latlng);
        return this.redraw();
    },

    setOptions: function (options) {
        L.setOptions(this, options);
        if (this._heat) {
            this._updateOptions();
        }
        return this.redraw();
    },

    redraw: function () {
        if (this._heat && !this._frame && this._map && !this._map._animating) {
            this._frame = L.Util.requestAnimFrame(this._redraw, this);
        }
        return this;
    },

    onAdd: function (map) {
        this._map = map;

        if (!this._canvas) {
            this._initCanvas();
        }

        if (this.options.pane) {
            this.getPane().appendChild(this._canvas);
        }else{
            map._panes.overlayPane.appendChild(this._canvas);
        }

        map.on('moveend zoomend', this._reset, this);

        if (map.options.zoomAnimation && L.Browser.any3d) {
            map.on('zoomanim', this._animateZoom, this);
        }

        this._reset();
    },

    onRemove: function (map) {
        if (this.options.pane) {
            this.getPane().removeChild(this._canvas);
        }else{
            map.getPanes().overlayPane.removeChild(this._canvas);
        }

        map.off('moveend', this._reset, this);

        if (map.options.zoomAnimation) {
            map.off('zoomanim', this._animateZoom, this);
        }
    },

    addTo: function (map) {
        map.addLayer(this);
        return this;
    },

    _initCanvas: function () {
        var canvas = this._canvas = L.DomUtil.create('canvas', 'leaflet-heatmap-layer leaflet-layer');

        var originProp = L.DomUtil.testProp(['transformOrigin', 'WebkitTransformOrigin', 'msTransformOrigin']);
        canvas.style[originProp] = '50% 50%';

        var size = this._map.getSize();
        canvas.width  = size.x;
        canvas.height = size.y;

        var animated = this._map.options.zoomAnimation && L.Browser.any3d;
        L.DomUtil.addClass(canvas, 'leaflet-zoom-' + (animated ? 'animated' : 'hide'));


        this._heat = simpleheat(canvas);
        this._canvas = canvas;
        this._updateOptions();
    },

    _updateOptions: function () {
        this._heat.radius(this.options.radius || this._heat.defaultRadius, this.options.blur);

        if (this.options.gradient) {
            this._heat.gradient(this.options.gradient);
        }
        if (this.options.max) {
            this._heat.max(this.options.max);
        }
        if (this.options.opacity || 0.8) {
            this._canvas.style['opacity'] = this.options.opacity;
        }
    },

    _reset: function () {

        if (this.options.radius_func) {
            var r = this.options.radius_func(this._map.getZoom());
            this._heat.radius(r, r / 2);
        }
        
        var that = this;
        if (this.options.url) {
            this._latlngs = this._getData(function (data) {
                that._latlngs = that.options.parseResponse(data);
                that._redraw();
            });
        } else if (this.options.latlngs) {
            this._latlngs = latlngs;
            that._redraw();
        }

    },

    _redraw: function () {
        if (!this._map) {
            return;
        }
        var data = [],
            r = this._heat._r,
            size = this._map.getSize(),
            bounds = new L.Bounds(
                L.point([-r, -r]),
                size.add([r, r])),

            max = this.options.max === undefined ? 1 : this.options.max,
            maxZoom = this.options.maxZoom === undefined ? this._map.getMaxZoom() : this.options.maxZoom,
            v = 1 / Math.pow(2, Math.max(0, Math.min(maxZoom - this._map.getZoom(), 12))),
            cellSize = r / 2,
            grid = [],
            panePos = this._map._getMapPanePos(),
            offsetX = panePos.x % cellSize,
            offsetY = panePos.y % cellSize,
            i, len, p, cell, x, y, j, len2, k;

        // console.time('process');
        for (i = 0, len = this._latlngs.length; i < len; i++) {
            p = this._map.latLngToContainerPoint(this._latlngs[i]);
            if (bounds.contains(p)) {
                x = Math.floor((p.x - offsetX) / cellSize) + 2;
                y = Math.floor((p.y - offsetY) / cellSize) + 2;

                var alt =
                    this._latlngs[i].alt !== undefined ? this._latlngs[i].alt :
                    this._latlngs[i][2] !== undefined ? +this._latlngs[i][2] : 1;
                k = alt * v;

                grid[y] = grid[y] || [];
                cell = grid[y][x];

                if (!cell) {
                    grid[y][x] = [p.x, p.y, k];

                } else {
                    cell[0] = (cell[0] * cell[2] + p.x * k) / (cell[2] + k); // x
                    cell[1] = (cell[1] * cell[2] + p.y * k) / (cell[2] + k); // y
                    cell[2] += k; // cumulated intensity value
                }
            }
        }

        for (i = 0, len = grid.length; i < len; i++) {
            if (grid[i]) {
                for (j = 0, len2 = grid[i].length; j < len2; j++) {
                    cell = grid[i][j];
                    if (cell) {
                        data.push([
                            Math.round(cell[0]),
                            Math.round(cell[1]),
                            Math.min(cell[2], max)
                        ]);
                    }
                }
            }
        }
        // console.timeEnd('process');

        var topLeft = this._map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);

        var size = this._map.getSize();
        
        if (this._heat._width !== size.x) {
            this._canvas.width = this._heat._width  = size.x;
        }
        if (this._heat._height !== size.y) {
            this._canvas.height = this._heat._height = size.y;
        }

        // console.time('draw ' + data.length);
        this._heat.data(data).draw(this.options.minOpacity);
        // console.timeEnd('draw ' + data.length);

        this._frame = null;
    },

    _getData: function (cb) {
        this._callData = this._getAjax;
        if(this.options.jsonpParam)
        {
            this.options.url += '&'+this.options.jsonpParam+'=';
            this._callData = this._getJsonp;
        }

		this._curReq = null;
		var bb = this._map.getBounds(),
			sw = bb.getSouthWest(),
			ne = bb.getNorthEast(),
            bbox = L.Util.template(this.options.url, {
					minX: sw.lng, minY: sw.lat,
					maxX: ne.lng, maxY: ne.lat
				});

		if(this._curReq)
			this._curReq.abort();  //prevent parallel requests

		var that = this;
		this._curReq = this._callData(bbox, function(data) {
			that._curReq = null;
			cb(data);
		});
    },
    
    _getAjax: function(url, cb) {  //default ajax request

        if (window.XMLHttpRequest === undefined) {
            window.XMLHttpRequest = function() {
                try {
                    return new ActiveXObject("Microsoft.XMLHTTP.6.0");
                }
                catch  (e1) {
                    try {
                        return new ActiveXObject("Microsoft.XMLHTTP.3.0");
                    }
                    catch (e2) {
                        throw new Error("XMLHttpRequest is not supported");
                    }
                }
            };
        }
        var request = new XMLHttpRequest();
        request.open('GET', url);
        request.onreadystatechange = function() {
            var response = {};
            if (request.readyState === 4 && request.status === 200) {
                try {
                    if(window.JSON)
                        response = JSON.parse(request.responseText);
                    else
                        response = eval("("+ request.responseText + ")");
                } catch(err) {
                    response = {};                    
                    throw new Error('Ajax response is not JSON');
                }
                cb(response);
            }
        };
        request.send();
        return request;
    },

    _getJsonp: function(url, cb) {  //extract searched records from remote jsonp service
        var body = document.getElementsByTagName('body')[0],
            script = L.DomUtil.create('script','leaflet-layerjson-jsonp', body );

        //JSONP callback
        L.LayerJSON.callJsonp = function(data) {
            cb(data);
            body.removeChild(script);
        };
        script.type = 'text/javascript';
        script.src = url+'L.LayerJSON.callJsonp';
        return {
            abort: function() {
                script.parentNode.removeChild(script);
            }
        };
    },

    _animateZoom: function (e) {
        var scale = this._map.getZoomScale(e.zoom),
            offset = this._map._getCenterOffset(e.center)._multiplyBy(-scale).subtract(this._map._getMapPanePos());

        if (L.DomUtil.setTransform) {
            L.DomUtil.setTransform(this._canvas, offset, scale);

        } else {
            this._canvas.style[L.DomUtil.TRANSFORM] = L.DomUtil.getTranslateString(offset) + ' scale(' + scale + ')';
        }
    }
});

L.heatLayer = function (latlngs, options) {
    return new L.HeatLayer(latlngs, options);
};
