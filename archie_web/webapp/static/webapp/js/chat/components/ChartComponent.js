// Chart component - separate component to use hooks properly
const ChatChartComponent = ({ chart, order }) => {
    const { useEffect, useRef } = React;
    const canvasRef = useRef(null);
    const chartInstanceRef = useRef(null);
    
    useEffect(() => {
        if (!canvasRef.current) {
            console.log('ChartComponent: canvas ref not ready');
            return;
        }
        
        console.log('ChartComponent: Rendering chart', chart);
        
        const ctx = canvasRef.current.getContext('2d');
        
        // Destroy previous chart instance if exists
        if (chartInstanceRef.current) {
            chartInstanceRef.current.destroy();
        }
        
        let chartConfig;

        // Robust parser for chart.chart_config
        function safeParseChartConfig(input) {
            console.log('safeParseChartConfig: input type:', typeof input);
            console.log('safeParseChartConfig: input value:', input);
            
            if (input === null || input === undefined) return null;
            
            // If it's already an object, return it directly
            if (typeof input === 'object') {
                console.log('safeParseChartConfig: Already an object, returning as-is');
                return input;
            }

            let s = String(input).trim();
            console.log('safeParseChartConfig: String to parse:', s.substring(0, 100) + '...');

            // If it's double-quoted JSON, unwrap and unescape inner quotes
            if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
                s = s.slice(1, -1);
                s = s.replace(/\\\"/g, '"').replace(/\\\'/g, "'");
                console.log('safeParseChartConfig: After unwrapping quotes:', s.substring(0, 100) + '...');
            }

            // Extract first JSON object block if surrounding text exists
            const firstBrace = s.indexOf('{');
            const lastBrace = s.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                s = s.slice(firstBrace, lastBrace + 1);
                console.log('safeParseChartConfig: After extracting JSON block:', s.substring(0, 100) + '...');
            }

            // Strip control chars
            s = s.replace(/[\u0000-\u001F\u007F]+/g, '');

            // Convert smart quotes to normal quotes
            s = s.replace(/[""]/g, '"').replace(/['']/g, "'");

            // Remove trailing commas before closing braces/brackets
            s = s.replace(/,\s*([}\]])/g, '$1');
            
            // Fix truncated JSON: if string ends with closing braces but JSON.parse fails,
            // try counting braces and adding missing ones
            const openBraces = (s.match(/\{/g) || []).length;
            const closeBraces = (s.match(/\}/g) || []).length;
            if (openBraces > closeBraces) {
                console.log(`safeParseChartConfig: JSON has ${openBraces} opening braces but only ${closeBraces} closing braces. Adding ${openBraces - closeBraces} missing braces.`);
                s = s + '}'.repeat(openBraces - closeBraces);
            }

            console.log('safeParseChartConfig: Final string before parse:', s.substring(0, 100) + '...');
            console.log('safeParseChartConfig: String length:', s.length);
            console.log('safeParseChartConfig: Character at position 378:', s.charCodeAt(378), 'char:', s.charAt(378));
            console.log('safeParseChartConfig: Context around 378:', s.substring(370, 390));

            try {
                const parsed = JSON.parse(s);
                console.log('safeParseChartConfig: Successfully parsed!');
                return parsed;
            } catch (err) {
                console.log('safeParseChartConfig: First parse failed:', err.message);
                console.log('safeParseChartConfig: Full string:', s);
                // Try unescaping escaped quotes and parse again
                try {
                    const unescaped = s.replace(/\\"/g, '"');
                    const parsed = JSON.parse(unescaped);
                    console.log('safeParseChartConfig: Successfully parsed after unescaping!');
                    return parsed;
                } catch (err2) {
                    console.log('safeParseChartConfig: Second parse failed:', err2.message);
                    return null;
                }
            }
        }

        // Check if chart_config exists (as JSON string)
        if (chart.chart_config) {
            console.log('ChartComponent: Parsing chart_config');
            chartConfig = safeParseChartConfig(chart.chart_config);
            if (!chartConfig) {
                console.error('ChartComponent: Failed to parse chart_config after multiple fallbacks');
                return;
            }

            console.log('ChartComponent: Parsed config', chartConfig);

            // Apply dark theme styles to the parsed config
            chartConfig.options = chartConfig.options || {};
            chartConfig.options.responsive = true;
            chartConfig.options.maintainAspectRatio = false;

            // Dark theme for plugins
            chartConfig.options.plugins = chartConfig.options.plugins || {};
            chartConfig.options.plugins.legend = chartConfig.options.plugins.legend || {};
            chartConfig.options.plugins.legend.labels = chartConfig.options.plugins.legend.labels || {};
            chartConfig.options.plugins.legend.labels.color = 'rgba(255, 255, 255, 0.9)';

            chartConfig.options.plugins.tooltip = chartConfig.options.plugins.tooltip || {};
            chartConfig.options.plugins.tooltip.backgroundColor = 'rgba(0, 0, 0, 0.8)';
            chartConfig.options.plugins.tooltip.titleColor = 'rgba(255, 255, 255, 1)';
            chartConfig.options.plugins.tooltip.bodyColor = 'rgba(255, 255, 255, 0.9)';
            chartConfig.options.plugins.tooltip.borderColor = 'rgba(0, 191, 255, 0.5)';
            chartConfig.options.plugins.tooltip.borderWidth = 1;

            // Dark theme for scales
            chartConfig.options.scales = chartConfig.options.scales || {};
            if (chartConfig.options.scales.y) {
                chartConfig.options.scales.y.grid = chartConfig.options.scales.y.grid || {};
                chartConfig.options.scales.y.grid.color = 'rgba(255, 255, 255, 0.1)';
                chartConfig.options.scales.y.ticks = chartConfig.options.scales.y.ticks || {};
                chartConfig.options.scales.y.ticks.color = 'rgba(255, 255, 255, 0.7)';
            }
            if (chartConfig.options.scales.x) {
                chartConfig.options.scales.x.grid = chartConfig.options.scales.x.grid || {};
                chartConfig.options.scales.x.grid.color = 'rgba(255, 255, 255, 0.1)';
                chartConfig.options.scales.x.ticks = chartConfig.options.scales.x.ticks || {};
                chartConfig.options.scales.x.ticks.color = 'rgba(255, 255, 255, 0.7)';
            }
        } else if (chart.data) {
            // Fallback: use chart.data if chart_config is not provided
            const chartData = {
                labels: chart.data.labels || [],
                datasets: (chart.data.datasets || []).map(dataset => ({
                    label: dataset.label || '',
                    data: dataset.data || [],
                    backgroundColor: dataset.background_color || 'rgba(0, 191, 255, 0.6)',
                    borderColor: dataset.border_color || 'rgba(0, 191, 255, 1)',
                    borderWidth: dataset.border_width || 2,
                    tension: dataset.tension || 0.4
                }))
            };
            
            chartConfig = {
                type: chart.chart_type,
                data: chartData,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: {
                                color: 'rgba(255, 255, 255, 0.9)',
                                font: {
                                    size: 12
                                }
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleColor: 'rgba(255, 255, 255, 1)',
                            bodyColor: 'rgba(255, 255, 255, 0.9)',
                            borderColor: 'rgba(0, 191, 255, 0.5)',
                            borderWidth: 1
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                            },
                            ticks: {
                                color: 'rgba(255, 255, 255, 0.7)'
                            }
                        },
                        x: {
                            grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                            },
                            ticks: {
                                color: 'rgba(255, 255, 255, 0.7)'
                            }
                        }
                    }
                }
            };
        } else {
            // No data available
            console.error('ChartComponent: No chart_config or chart.data provided');
            return;
        }
        
        console.log('ChartComponent: Creating Chart instance with config', chartConfig);
        
        try {
            chartInstanceRef.current = new Chart(ctx, chartConfig);
            console.log('ChartComponent: Chart created successfully', chartInstanceRef.current);
        } catch (e) {
            console.error('ChartComponent: Failed to create chart:', e);
        }
        
        // Cleanup function
        return () => {
            if (chartInstanceRef.current) {
                chartInstanceRef.current.destroy();
            }
        };
    }, [chart]);
    
    return React.createElement('div', {
        className: 'backdrop-blur-lg bg-white/10 rounded-xl shadow-2xl p-6 border border-white/20 mb-4'
    }, [
        chart.title && React.createElement('h3', {
            key: 'chart-title',
            className: 'text-xl font-bold text-white mb-2'
        }, chart.title),
        chart.description && React.createElement('p', {
            key: 'chart-description',
            className: 'text-white/70 mb-4'
        }, chart.description),
        React.createElement('div', {
            key: 'chart-container',
            style: { height: `${chart.height || 300}px`, position: 'relative' }
        }, React.createElement('canvas', {
            ref: canvasRef,
            style: { maxHeight: '100%' }
        }))
    ]);
};
