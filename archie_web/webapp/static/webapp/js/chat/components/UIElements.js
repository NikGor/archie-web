// UI Elements Components

// Parse markdown, then apply hljs highlighting via post-processing
const parseMarkdownWithPillLinks = (text) => {
    if (typeof marked === 'undefined') return text;

    let html = marked.parse(text);

    // Post-process: apply hljs syntax highlighting to code blocks
    if (typeof hljs !== 'undefined') {
        html = html.replace(
            /<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
            (match, lang, encodedCode) => {
                if (lang === 'mermaid') return match;
                // Decode HTML entities that marked encoded
                const code = encodedCode
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&amp;/g, '&')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'");
                const language = lang && hljs.getLanguage(lang) ? lang : null;
                const highlighted = language
                    ? hljs.highlight(code, { language }).value
                    : hljs.highlightAuto(code).value;
                const cls = language ? `hljs language-${language}` : 'hljs';
                return `<pre><code class="${cls}">${highlighted}</code></pre>`;
            }
        );
    }

    // Post-process: convert pill-style links
    html = html.replace(
        /<a href="([^"]*)"(?: title="([^"]*)")?>([\s\S]*?)<\/a>/g,
        (match, href, title, linkText) => {
            if (!href) return match;
            const pillClass = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-white/20 hover:bg-white/30 text-white border border-white/30 transition-all duration-200 cursor-pointer no-underline';
            const titleAttr = title ? ` title="${title}"` : '';
            return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="${pillClass}"${titleAttr}><span class="mr-1">🔗</span>${linkText}</a>`;
        }
    );

    return html;
};

// Frontend button command handlers
const handleFrontendCommand = (command, cardData, button) => {
    switch (command) {
        case 'open_map': {
            const address = cardData.address || cardData.title || '';
            const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
            window.open(url, '_blank');
            break;
        }
        case 'open_on_youtube_video': {
            const query = cardData.title || '';
            const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
            window.open(url, '_blank');
            break;
        }
        case 'open_on_youtube_music':
        case 'play_on_spotify': {
            const query = cardData.track_title
                ? `${cardData.track_title} ${cardData.artist || ''}`.trim()
                : cardData.title || '';
            if (query) spotifyControl('play_track', query);
            break;
        }
        case 'check_amazon': {
            const query = cardData.title || '';
            const url = `https://www.amazon.de/s?k=${encodeURIComponent(query)}`;
            window.open(url, '_blank');
            break;
        }
        case 'url_to': {
            if (button.url) {
                window.open(button.url, '_blank');
            }
            break;
        }
        default:
            console.log('Unhandled frontend command:', command);
    }
};

// Human-readable hover tooltip explaining what a button does:
// an assistant request vs. a link/action, with per-command specificity.
const FRONTEND_COMMAND_LABELS = {
    open_map: 'Opens the location in Google Maps',
    open_on_youtube_video: 'Searches YouTube in a new tab',
    open_on_youtube_music: 'Plays on Spotify',
    play_on_spotify: 'Plays on Spotify',
    check_amazon: 'Searches Amazon in a new tab',
    navigate_to: 'Navigates to another screen',
    call: 'Starts a phone call',
    email: 'Composes an email',
    message: 'Opens a message',
    show_details: 'Shows more details',
    export_to_notes: 'Saves to notes',
    export_to_calendar: 'Adds to your calendar',
    url_to: 'Opens a link in a new tab',
};

const getButtonTooltip = (button) => {
    if (button.type === 'assistant_button') {
        return button.assistant_request
            ? `Sends to the assistant: "${button.assistant_request}"`
            : 'Sends a request to the assistant';
    }
    if (button.type === 'frontend_button') {
        const label = FRONTEND_COMMAND_LABELS[button.command] || 'Runs an action';
        return button.command === 'url_to' && button.url
            ? `Opens a link in a new tab: ${button.url}`
            : label;
    }
    return undefined;
};

const ChatButton = ({ button, onExecute, cardData }) => {
    const handleClick = () => {
        if (button.type === 'assistant_button') {
            onExecute(button.assistant_request);
        } else if (button.type === 'frontend_button') {
            handleFrontendCommand(button.command, cardData || {}, button);
        }
    };

    return React.createElement('button', {
        onClick: handleClick,
        title: getButtonTooltip(button),
        className: `px-3 py-2 rounded-full text-sm font-semibold transition-all duration-300 ${getButtonStyle(button.style)}`
    }, [
        button.icon && React.createElement('i', {
            key: 'icon',
            'data-lucide': button.icon,
            className: 'w-4 h-4 inline-block mr-2'
        }),
        React.createElement('span', {
            key: 'text'
        }, button.text)
    ]);
};

// mm:ss formatter scoped to this widget (chat/utils.js's formatTime formats dates, not durations)
const formatTrackDuration = (seconds) => {
    if (!Number.isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const SPOTIFY_REPEAT_CYCLE = { off: 'context', context: 'track', track: 'off' };

// Spotify player widget (renders MusicWidget: cover, track/artist, progress,
// transport + shuffle/repeat/favorite controls, upcoming queue)
const SpotifyPlayerWidget = ({ widget }) => {
    const [playback, setPlayback] = React.useState(widget.playback || {});
    const progressBarRef = React.useRef(null);

    React.useEffect(() => {
        const handleState = (event) => {
            const state = event.detail;
            if (!state) return;
            const track = state.track_window && state.track_window.current_track;
            setPlayback(prev => ({
                is_playing: !state.paused,
                progress_seconds: Math.round(state.position / 1000),
                volume: prev.volume,
                shuffle: typeof state.shuffle === 'boolean' ? state.shuffle : prev.shuffle,
                repeat: typeof state.repeat_mode === 'number'
                    ? ['off', 'context', 'track'][state.repeat_mode]
                    : prev.repeat,
                current_track: track ? {
                    title: track.name,
                    artist: (track.artists || []).map(a => a.name).join(', '),
                    album: track.album ? track.album.name : null,
                    duration_seconds: Math.round(state.duration / 1000),
                    cover_url: track.album && track.album.images && track.album.images[0]
                        ? track.album.images[0].url : null,
                    is_favorite: prev.current_track ? prev.current_track.is_favorite : false
                } : null
            }));
        };
        window.addEventListener('spotify:state', handleState);
        return () => window.removeEventListener('spotify:state', handleState);
    }, []);

    const track = playback.current_track;
    const progress = track && track.duration_seconds
        ? Math.min(100, (playback.progress_seconds / track.duration_seconds) * 100)
        : 0;

    const handleSeek = (e) => {
        if (!track || !progressBarRef.current) return;
        const rect = progressBarRef.current.getBoundingClientRect();
        const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const newProgress = Math.round(fraction * track.duration_seconds);
        spotifyControl('seek', newProgress);
        setPlayback(prev => ({ ...prev, progress_seconds: newProgress }));
    };

    const handleShuffleClick = () => {
        const next = !playback.shuffle;
        spotifyControl('shuffle', next);
        setPlayback(prev => ({ ...prev, shuffle: next }));
    };

    const handleRepeatClick = () => {
        const next = SPOTIFY_REPEAT_CYCLE[playback.repeat || 'off'];
        spotifyControl('repeat', next);
        setPlayback(prev => ({ ...prev, repeat: next }));
    };

    const handleFavoriteClick = () => {
        if (!track) return;
        const next = !track.is_favorite;
        spotifyControl(next ? 'favorite' : 'unfavorite');
        setPlayback(prev => ({ ...prev, current_track: { ...prev.current_track, is_favorite: next } }));
    };

    const handleQueueItemClick = (item) => {
        spotifyControl('play_track', `${item.title} — ${item.artist}`);
    };

    return React.createElement('div', {
        className: 'backdrop-blur-lg bg-white/10 rounded-2xl p-4 border border-white/20'
    }, [
        React.createElement('div', {
            key: 'header',
            className: 'flex items-center gap-4'
        }, [
            React.createElement('div', {
                key: 'cover',
                className: 'w-14 h-14 rounded-lg bg-white/10 flex-shrink-0 overflow-hidden flex items-center justify-center'
            }, track && track.cover_url
                ? React.createElement('img', { src: track.cover_url, className: 'w-full h-full object-cover' })
                : React.createElement('i', { 'data-lucide': 'music', className: 'w-6 h-6 text-white/40' })
            ),
            React.createElement('div', { key: 'meta', className: 'min-w-0 flex-1' }, [
                React.createElement('div', {
                    key: 'title',
                    className: 'text-white font-medium truncate'
                }, track ? track.title : (widget.title || 'Music')),
                React.createElement('div', {
                    key: 'artist',
                    className: 'text-white/50 text-sm truncate'
                }, track ? track.artist : (widget.subtitle || ''))
            ]),
            track && React.createElement('button', {
                key: 'favorite',
                onClick: handleFavoriteClick,
                title: track.is_favorite ? 'Remove from favorites' : 'Add to favorites',
                className: track.is_favorite ? 'text-pink-400 hover:text-pink-300' : 'text-white/40 hover:text-white'
            }, React.createElement('i', {
                'data-lucide': 'heart',
                className: `w-5 h-5${track.is_favorite ? ' fill-current' : ''}`
            }))
        ]),
        React.createElement('div', {
            key: 'progress',
            ref: progressBarRef,
            onClick: handleSeek,
            className: 'mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden cursor-pointer'
        }, React.createElement('div', {
            className: 'h-full bg-indigo-400 pointer-events-none',
            style: { width: `${progress}%` }
        })),
        track && React.createElement('div', {
            key: 'times',
            className: 'flex justify-between text-white/40 text-xs mt-1'
        }, [
            React.createElement('span', { key: 'elapsed' }, formatTrackDuration(playback.progress_seconds)),
            React.createElement('span', { key: 'total' }, formatTrackDuration(track.duration_seconds))
        ]),
        React.createElement('div', {
            key: 'controls',
            className: 'flex items-center justify-center gap-4 mt-3'
        }, [
            React.createElement('button', {
                key: 'shuffle',
                onClick: handleShuffleClick,
                title: 'Shuffle',
                className: playback.shuffle ? 'text-indigo-300' : 'text-white/50 hover:text-white'
            }, React.createElement('i', { 'data-lucide': 'shuffle', className: 'w-4 h-4' })),
            React.createElement('button', {
                key: 'prev',
                onClick: () => spotifyControl('previous'),
                className: 'text-white/70 hover:text-white'
            }, React.createElement('i', { 'data-lucide': 'skip-back', className: 'w-5 h-5' })),
            React.createElement('button', {
                key: 'play',
                onClick: () => spotifyControl(playback.is_playing ? 'pause' : 'play'),
                className: 'text-white hover:text-indigo-300'
            }, React.createElement('i', { 'data-lucide': playback.is_playing ? 'pause' : 'play', className: 'w-6 h-6' })),
            React.createElement('button', {
                key: 'next',
                onClick: () => spotifyControl('next'),
                className: 'text-white/70 hover:text-white'
            }, React.createElement('i', { 'data-lucide': 'skip-forward', className: 'w-5 h-5' })),
            React.createElement('button', {
                key: 'repeat',
                onClick: handleRepeatClick,
                title: `Repeat: ${playback.repeat || 'off'}`,
                className: (playback.repeat && playback.repeat !== 'off') ? 'text-indigo-300' : 'text-white/50 hover:text-white'
            }, React.createElement('i', {
                'data-lucide': playback.repeat === 'track' ? 'repeat-1' : 'repeat',
                className: 'w-4 h-4'
            }))
        ]),
        widget.playlist && widget.playlist.length > 0 && React.createElement('div', {
            key: 'queue',
            className: 'mt-4 pt-3 border-t border-white/10'
        }, [
            React.createElement('div', {
                key: 'queue-label',
                className: 'text-white/40 text-xs uppercase tracking-wide mb-1'
            }, 'Up next'),
            ...widget.playlist.slice(0, 5).map((item, index) => React.createElement('button', {
                key: `queue-${item.track_id || index}`,
                onClick: () => handleQueueItemClick(item),
                className: 'flex items-center gap-2 w-full text-left py-1.5 px-2 -mx-2 rounded-lg hover:bg-white/5 transition-colors'
            }, [
                React.createElement('span', {
                    key: 'label',
                    className: 'text-white/80 text-sm truncate flex-1'
                }, `${item.title} — ${item.artist}`),
                React.createElement('span', {
                    key: 'duration',
                    className: 'text-white/30 text-xs flex-shrink-0'
                }, formatTrackDuration(item.duration_seconds))
            ]))
        ]),
        widget.quick_actions && React.createElement('div', {
            key: 'quick-actions',
            className: 'flex flex-wrap gap-2 mt-4 pt-3 border-t border-white/10'
        }, widget.quick_actions.map((button, index) =>
            React.createElement(ChatButton, { key: `spotify-qa-${index}`, button })
        ))
    ]);
};

// Renders a Level3Answer/Content widget by discriminated type
const renderContentWidget = (widget) => {
    const widgetType = widget.type || widget.widget_type;
    if (widgetType === 'music_widget') {
        return React.createElement(SpotifyPlayerWidget, { key: 'widget', widget });
    }
    return React.createElement('div', {
        key: 'widget',
        className: 'text-white/50 text-sm'
    }, `[Widget: ${widgetType}]`);
};

// Form helper to convert form data to YAML
const formDataToYaml = (formType, data) => {
    const lines = [`${formType}:`];
    for (const [key, value] of Object.entries(data)) {
        if (value !== null && value !== undefined && value !== '') {
            lines.push(`  ${key}: "${value}"`);
        } else {
            lines.push(`  ${key}: null`);
        }
    }
    return lines.join('\n');
};

// Common form input component
const FormInput = ({ label, name, type, value, onChange, placeholder, required }) => {
    return React.createElement('div', {
        className: 'mb-4'
    }, [
        React.createElement('label', {
            key: 'label',
            className: 'block text-sm font-medium text-white/80 mb-1'
        }, label + (required ? ' *' : '')),
        React.createElement('input', {
            key: 'input',
            type: type || 'text',
            name: name,
            value: value || '',
            onChange: (e) => onChange(name, e.target.value),
            placeholder: placeholder,
            className: 'w-full px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-all'
        })
    ]);
};

// Common form textarea component
const FormTextarea = ({ label, name, value, onChange, placeholder, rows }) => {
    return React.createElement('div', {
        className: 'mb-4'
    }, [
        React.createElement('label', {
            key: 'label',
            className: 'block text-sm font-medium text-white/80 mb-1'
        }, label),
        React.createElement('textarea', {
            key: 'textarea',
            name: name,
            value: value || '',
            onChange: (e) => onChange(name, e.target.value),
            placeholder: placeholder,
            rows: rows || 3,
            className: 'w-full px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-all resize-y'
        })
    ]);
};

// Event Form Component
const ChatEventForm = ({ content, onExecute }) => {
    const [formData, setFormData] = React.useState({
        title: content.title || '',
        date: content.date || '',
        time: content.time || '',
        duration_minutes: content.duration_minutes || '',
        location: content.location || '',
        description: content.description || ''
    });

    const handleChange = (name, value) => {
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = () => {
        const yaml = formDataToYaml('event_form', formData);
        const request = `Create calendar event:\n\`\`\`yaml\n${yaml}\n\`\`\``;
        onExecute(request);
    };

    const handleCancel = () => {
        onExecute('Cancel creating calendar event');
    };

    return React.createElement('div', {
        className: 'backdrop-blur-lg bg-white/10 rounded-2xl p-6 border-2 border-indigo-500 shadow-xl shadow-indigo-500/20'
    }, [
        React.createElement('div', {
            key: 'header',
            className: 'flex items-center gap-3 mb-4'
        }, [
            React.createElement('i', {
                key: 'icon',
                'data-lucide': 'calendar-plus',
                className: 'w-6 h-6 text-indigo-400'
            }),
            React.createElement('h3', {
                key: 'title',
                className: 'text-lg font-semibold text-white'
            }, 'New event')
        ]),
        React.createElement('div', {
            key: 'form',
            className: 'space-y-1'
        }, [
            React.createElement(FormInput, {
                key: 'title',
                label: 'Title',
                name: 'title',
                value: formData.title,
                onChange: handleChange,
                placeholder: 'Enter event title',
                required: true
            }),
            React.createElement('div', {
                key: 'datetime-row',
                className: 'grid grid-cols-2 gap-4'
            }, [
                React.createElement(FormInput, {
                    key: 'date',
                    label: 'Date',
                    name: 'date',
                    value: formData.date,
                    onChange: handleChange,
                    placeholder: 'DD.MM.YYYY',
                    required: true
                }),
                React.createElement(FormInput, {
                    key: 'time',
                    label: 'Time',
                    name: 'time',
                    value: formData.time,
                    onChange: handleChange,
                    placeholder: 'HH:MM'
                })
            ]),
            React.createElement('div', {
                key: 'duration-location-row',
                className: 'grid grid-cols-2 gap-4'
            }, [
                React.createElement(FormInput, {
                    key: 'duration',
                    label: 'Duration (min)',
                    name: 'duration_minutes',
                    type: 'number',
                    value: formData.duration_minutes,
                    onChange: handleChange,
                    placeholder: '60'
                }),
                React.createElement(FormInput, {
                    key: 'location',
                    label: 'Location',
                    name: 'location',
                    value: formData.location,
                    onChange: handleChange,
                    placeholder: 'Where the event takes place'
                })
            ]),
            React.createElement(FormTextarea, {
                key: 'description',
                label: 'Description',
                name: 'description',
                value: formData.description,
                onChange: handleChange,
                placeholder: 'Additional notes',
                rows: 2
            })
        ]),
        React.createElement('div', {
            key: 'buttons',
            className: 'flex gap-3 mt-6'
        }, [
            React.createElement('button', {
                key: 'submit',
                onClick: handleSubmit,
                className: 'flex-1 px-4 py-2 rounded-full text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all duration-300 flex items-center justify-center gap-2'
            }, [
                React.createElement('i', {
                    key: 'icon',
                    'data-lucide': 'check',
                    className: 'w-4 h-4'
                }),
                React.createElement('span', { key: 'text' }, 'Create')
            ]),
            React.createElement('button', {
                key: 'cancel',
                onClick: handleCancel,
                className: 'px-4 py-2 rounded-full text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-white transition-all duration-300 flex items-center justify-center gap-2'
            }, [
                React.createElement('i', {
                    key: 'icon',
                    'data-lucide': 'x',
                    className: 'w-4 h-4'
                }),
                React.createElement('span', { key: 'text' }, 'Cancel')
            ])
        ])
    ]);
};

// Email Form Component
const ChatEmailForm = ({ content, onExecute }) => {
    const [formData, setFormData] = React.useState({
        to: content.to || '',
        subject: content.subject || '',
        body: content.body || ''
    });

    const handleChange = (name, value) => {
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = () => {
        const yaml = formDataToYaml('email_form', formData);
        const request = `Send email:\n\`\`\`yaml\n${yaml}\n\`\`\``;
        onExecute(request);
    };

    const handleCancel = () => {
        onExecute('Cancel sending email');
    };

    return React.createElement('div', {
        className: 'w-full backdrop-blur-lg bg-white/10 rounded-2xl p-6 border-2 border-sky-500 shadow-xl shadow-sky-500/20'
    }, [
        React.createElement('div', {
            key: 'header',
            className: 'flex items-center gap-3 mb-4'
        }, [
            React.createElement('i', {
                key: 'icon',
                'data-lucide': 'mail',
                className: 'w-6 h-6 text-sky-400'
            }),
            React.createElement('h3', {
                key: 'title',
                className: 'text-lg font-semibold text-white'
            }, 'New email')
        ]),
        React.createElement('div', {
            key: 'form',
            className: 'space-y-1'
        }, [
            React.createElement(FormInput, {
                key: 'to',
                label: 'To',
                name: 'to',
                type: 'email',
                value: formData.to,
                onChange: handleChange,
                placeholder: 'email@example.com',
                required: true
            }),
            React.createElement(FormInput, {
                key: 'subject',
                label: 'Subject',
                name: 'subject',
                value: formData.subject,
                onChange: handleChange,
                placeholder: 'Email subject'
            }),
            React.createElement(FormTextarea, {
                key: 'body',
                label: 'Email body',
                name: 'body',
                value: formData.body,
                onChange: handleChange,
                placeholder: 'Enter email text...',
                rows: 5
            })
        ]),
        React.createElement('div', {
            key: 'buttons',
            className: 'flex gap-3 mt-6'
        }, [
            React.createElement('button', {
                key: 'submit',
                onClick: handleSubmit,
                className: 'flex-1 px-4 py-2 rounded-full text-sm font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-all duration-300 flex items-center justify-center gap-2'
            }, [
                React.createElement('i', {
                    key: 'icon',
                    'data-lucide': 'send',
                    className: 'w-4 h-4'
                }),
                React.createElement('span', { key: 'text' }, 'Send')
            ]),
            React.createElement('button', {
                key: 'cancel',
                onClick: handleCancel,
                className: 'px-4 py-2 rounded-full text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-white transition-all duration-300 flex items-center justify-center gap-2'
            }, [
                React.createElement('i', {
                    key: 'icon',
                    'data-lucide': 'x',
                    className: 'w-4 h-4'
                }),
                React.createElement('span', { key: 'text' }, 'Cancel')
            ])
        ])
    ]);
};

// Internal Note Form Component
const ChatNoteForm = ({ content, onExecute }) => {
    const [formData, setFormData] = React.useState({
        title: content.title || '',
        content: content.content || ''
    });

    const handleChange = (name, value) => {
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = () => {
        const yaml = formDataToYaml('note_form', formData);
        const request = `Save note:\n\`\`\`yaml\n${yaml}\n\`\`\``;
        onExecute(request);
    };

    const handleCancel = () => {
        onExecute('Cancel creating note');
    };

    return React.createElement('div', {
        className: 'backdrop-blur-lg bg-white/10 rounded-2xl p-6 border-2 border-amber-500 shadow-xl shadow-amber-500/20'
    }, [
        React.createElement('div', {
            key: 'header',
            className: 'flex items-center gap-3 mb-4'
        }, [
            React.createElement('i', {
                key: 'icon',
                'data-lucide': 'sticky-note',
                className: 'w-6 h-6 text-amber-400'
            }),
            React.createElement('h3', {
                key: 'title',
                className: 'text-lg font-semibold text-white'
            }, 'New note')
        ]),
        React.createElement('div', {
            key: 'form',
            className: 'space-y-1'
        }, [
            React.createElement(FormInput, {
                key: 'title',
                label: 'Title',
                name: 'title',
                value: formData.title,
                onChange: handleChange,
                placeholder: 'Note title'
            }),
            React.createElement(FormTextarea, {
                key: 'content',
                label: 'Content',
                name: 'content',
                value: formData.content,
                onChange: handleChange,
                placeholder: 'Note text...',
                rows: 5
            })
        ]),
        React.createElement('div', {
            key: 'buttons',
            className: 'flex gap-3 mt-6'
        }, [
            React.createElement('button', {
                key: 'submit',
                onClick: handleSubmit,
                className: 'flex-1 px-4 py-2 rounded-full text-sm font-semibold bg-amber-600 hover:bg-amber-500 text-white transition-all duration-300 flex items-center justify-center gap-2'
            }, [
                React.createElement('i', {
                    key: 'icon',
                    'data-lucide': 'save',
                    className: 'w-4 h-4'
                }),
                React.createElement('span', { key: 'text' }, 'Save')
            ]),
            React.createElement('button', {
                key: 'cancel',
                onClick: handleCancel,
                className: 'px-4 py-2 rounded-full text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-white transition-all duration-300 flex items-center justify-center gap-2'
            }, [
                React.createElement('i', {
                    key: 'icon',
                    'data-lucide': 'x',
                    className: 'w-4 h-4'
                }),
                React.createElement('span', { key: 'text' }, 'Cancel')
            ])
        ])
    ]);
};

const ChatCardGrid = ({ cardGrid, onExecute }) => {
    const gridClass = cardGrid.grid_dimensions === '2_columns' 
        ? 'grid grid-cols-1 md:grid-cols-2 gap-4 mb-4' 
        : 'grid grid-cols-1 gap-4 mb-4';
    
    const isTwoColumns = cardGrid.grid_dimensions === '2_columns';

    const getCardStyle = (type) => {
        const baseStyle = 'backdrop-blur-lg bg-white/10 rounded-2xl p-4 shadow-xl transition-all duration-300';
        
        switch (type) {
            case 'location_card': 
                return `${baseStyle} border-2 border-emerald-500 hover:border-emerald-400 shadow-emerald-500/20`;
            case 'product_card': 
                return `${baseStyle} border-2 border-orange-500 hover:border-orange-400 shadow-orange-500/20`;
            case 'movie_card': 
            case 'series_card': 
                return `${baseStyle} border-2 border-violet-500 hover:border-violet-400 shadow-violet-500/20`;
            case 'music_card': 
                return `${baseStyle} border-2 border-pink-500 hover:border-pink-400 shadow-pink-500/20`;
            case 'article_card': 
                return `${baseStyle} border-2 border-sky-500 hover:border-sky-400 shadow-sky-500/20`;
            case 'shopping_list_card': 
                return `${baseStyle} border-2 border-yellow-500 hover:border-yellow-400 shadow-yellow-500/20`;
            case 'weather_card': 
                return `${baseStyle} border-2 border-cyan-500 hover:border-cyan-400 shadow-cyan-500/20`;
            case 'contact_card': 
                return `${baseStyle} border-2 border-indigo-500 hover:border-indigo-400 shadow-indigo-500/20`;
            case 'email_card':
                return `${baseStyle} border-2 border-rose-500 hover:border-rose-400 shadow-rose-500/20`;
            case 'card':
            default: 
                return `${baseStyle} border border-white/20 hover:border-white/40`;
        }
    };

    const renderCardContent = (card, isTwoColumns) => {
        const elements = [];
        
        // Email Card
        if (card.type === 'email_card') {
            const sender = [card.sender_name, card.sender_email && card.sender_email !== card.sender_name ? `<${card.sender_email}>` : null]
                .filter(Boolean).join(' ');
            elements.push(React.createElement('div', {
                key: 'email-header',
                className: 'flex items-center justify-between gap-2 mb-1'
            }, [
                React.createElement('span', {
                    key: 'sender',
                    className: `text-sm truncate ${card.is_unread ? 'font-semibold text-white' : 'text-white/80'}`
                }, `${card.is_unread ? '● ' : ''}${sender}`),
                card.received_at && React.createElement('span', {
                    key: 'date',
                    className: 'text-xs text-white/50 whitespace-nowrap'
                }, card.received_at)
            ]));
            elements.push(React.createElement('h3', {
                key: 'subject',
                className: `text-white mb-1 ${card.is_unread ? 'font-semibold' : 'font-medium'}`
            }, `${card.has_attachments ? '📎 ' : ''}${card.subject}`));
            card.snippet && elements.push(React.createElement('p', {
                key: 'snippet',
                className: 'text-sm text-white/70 mb-3 line-clamp-3'
            }, card.snippet));
        }
        // Contact Card
        else if (card.type === 'contact_card') {
            card.name && elements.push(React.createElement('h3', {
                key: 'name',
                className: 'font-semibold text-white mb-1'
            }, card.name));
            card.role && elements.push(React.createElement('p', {
                key: 'role',
                className: 'text-sm text-white/70 mb-1'
            }, card.role));
            card.company && elements.push(React.createElement('p', {
                key: 'company',
                className: 'text-xs text-white/60 mb-2'
            }, card.company));
            if (card.email || card.phone) {
                elements.push(React.createElement('div', {
                    key: 'contact-info',
                    className: 'text-sm text-white/80 mb-2 space-y-1'
                }, [
                    card.email && React.createElement('div', { key: 'email' }, `📧 ${card.email}`),
                    card.phone && React.createElement('div', { key: 'phone' }, `📞 ${card.phone}`)
                ]));
            }
            card.availability && elements.push(React.createElement('p', {
                key: 'availability',
                className: 'text-xs text-white/60 mb-3'
            }, card.availability));
        }
        // Location Card
        else if (card.type === 'location_card') {
            card.title && elements.push(React.createElement('h3', {
                key: 'title',
                className: 'font-semibold text-white mb-2'
            }, card.title));
            card.description && elements.push(React.createElement('p', {
                key: 'description',
                className: 'text-sm text-white/80 mb-2'
            }, card.description));
            card.address && elements.push(React.createElement('p', {
                key: 'address',
                className: 'text-xs text-white/60 mb-3'
            }, card.address));
        }
        // Movie Card
        else if (card.type === 'movie_card') {
            card.title && elements.push(React.createElement('h3', {
                key: 'title',
                className: 'font-semibold text-white text-lg mb-2'
            }, card.title));
            
            const metadata = [];
            card.year && metadata.push(`${card.year}`);
            card.director && metadata.push(`dir. ${card.director}`);
            if (metadata.length > 0) {
                elements.push(React.createElement('p', {
                    key: 'metadata',
                    className: 'text-sm text-white/70 mb-2'
                }, metadata.join(' • ')));
            }
            
            card.genre && elements.push(React.createElement('p', {
                key: 'genre',
                className: 'text-xs text-white/60 mb-2'
            }, `🎬 ${card.genre}`));
            
            if (card.cast && card.cast.length > 0) {
                elements.push(React.createElement('p', {
                    key: 'cast',
                    className: 'text-xs text-white/60 mb-2'
                }, `⭐ ${card.cast.join(', ')}`));
            }
            
            card.description && elements.push(React.createElement('p', {
                key: 'description',
                className: 'text-sm text-white/80 mb-3'
            }, card.description));
            
            if (card.rating || card.duration) {
                const extraInfo = [];
                card.rating && extraInfo.push(card.rating);
                card.duration && extraInfo.push(card.duration);
                elements.push(React.createElement('p', {
                    key: 'extra',
                    className: 'text-xs text-white/50'
                }, extraInfo.join(' • ')));
            }
        }
        // Series Card
        else if (card.type === 'series_card') {
            card.title && elements.push(React.createElement('h3', {
                key: 'title',
                className: 'font-semibold text-white text-lg mb-2'
            }, card.title));
            
            const metadata = [];
            card.years && metadata.push(card.years);
            card.status && metadata.push(card.status);
            if (metadata.length > 0) {
                elements.push(React.createElement('p', {
                    key: 'metadata',
                    className: 'text-sm text-white/70 mb-2'
                }, metadata.join(' • ')));
            }
            
            card.network && elements.push(React.createElement('p', {
                key: 'network',
                className: 'text-xs text-white/60 mb-2'
            }, `📺 ${card.network}`));
            
            if (card.seasons || card.episodes) {
                const seriesInfo = [];
                card.seasons && seriesInfo.push(`${card.seasons} seasons`);
                card.episodes && seriesInfo.push(`${card.episodes} episodes`);
                elements.push(React.createElement('p', {
                    key: 'series-info',
                    className: 'text-xs text-white/60 mb-2'
                }, seriesInfo.join(', ')));
            }
            
            card.genre && elements.push(React.createElement('p', {
                key: 'genre',
                className: 'text-xs text-white/60 mb-2'
            }, `🎭 ${card.genre}`));
            
            card.description && elements.push(React.createElement('p', {
                key: 'description',
                className: 'text-sm text-white/80 mb-3'
            }, card.description));
            
            card.rating && elements.push(React.createElement('p', {
                key: 'rating',
                className: 'text-xs text-white/50'
            }, card.rating));
        }
        // Music Card
        else if (card.type === 'music_card') {
            card.track_title && elements.push(React.createElement('h3', {
                key: 'title',
                className: 'font-semibold text-white text-lg mb-1'
            }, card.track_title));
            
            card.artist && elements.push(React.createElement('p', {
                key: 'artist',
                className: 'text-sm text-white/70 mb-2'
            }, `🎤 ${card.artist}`));
            
            if (card.album_title) {
                const albumInfo = [card.album_title];
                card.album_year && albumInfo.push(`${card.album_year}`);
                elements.push(React.createElement('p', {
                    key: 'album',
                    className: 'text-xs text-white/60 mb-2'
                }, `💿 ${albumInfo.join(' • ')}`));
            }
            
            const trackDetails = [];
            card.genre && trackDetails.push(card.genre);
            card.duration && trackDetails.push(card.duration);
            if (trackDetails.length > 0) {
                elements.push(React.createElement('p', {
                    key: 'details',
                    className: 'text-xs text-white/50'
                }, trackDetails.join(' • ')));
            }
        }
        // Article Card
        else if (card.type === 'article_card') {
            card.title && elements.push(React.createElement('h3', {
                key: 'title',
                className: 'font-semibold text-white text-lg mb-2'
            }, card.title));
            
            const metadata = [];
            card.source && metadata.push(card.source);
            card.published_date && metadata.push(card.published_date);
            if (metadata.length > 0) {
                elements.push(React.createElement('p', {
                    key: 'metadata',
                    className: 'text-xs text-white/60 mb-2'
                }, `📰 ${metadata.join(' • ')}`));
            }
            
            card.summary && elements.push(React.createElement('p', {
                key: 'summary',
                className: 'text-sm text-white/80 mb-3'
            }, card.summary));
        }
        // Document Card
        else if (card.type === 'document_card') {
            card.filename && elements.push(React.createElement('h3', {
                key: 'filename',
                className: 'font-semibold text-white text-lg mb-1'
            }, card.filename));
            
            card.title && elements.push(React.createElement('p', {
                key: 'title',
                className: 'text-sm text-white/70 mb-2'
            }, card.title));
            
            const docMeta = [];
            card.document_type && docMeta.push(card.document_type);
            card.date && docMeta.push(card.date);
            if (docMeta.length > 0) {
                elements.push(React.createElement('p', {
                    key: 'doc-meta',
                    className: 'text-xs text-white/60 mb-2'
                }, `📄 ${docMeta.join(' • ')}`));
            }
            
            card.snippet && elements.push(React.createElement('p', {
                key: 'snippet',
                className: 'text-sm text-white/80 mb-2 italic border-l-2 border-white/30 pl-3'
            }, card.snippet));
            
            const docDetails = [];
            card.amount && docDetails.push(`💰 ${card.amount}`);
            card.relevance_score && docDetails.push(`🎯 ${Math.round(card.relevance_score * 100)}%`);
            if (docDetails.length > 0) {
                elements.push(React.createElement('p', {
                    key: 'doc-details',
                    className: 'text-xs text-white/50'
                }, docDetails.join(' • ')));
            }
        }
        // Shopping List Card
        else if (card.type === 'shopping_list_card') {
            card.title && elements.push(React.createElement('h3', {
                key: 'title',
                className: 'font-semibold text-white text-lg mb-3'
            }, card.title));
            
            if (card.items_by_department) {
                const deptElements = Object.entries(card.items_by_department).map(([dept, items], idx) => 
                    React.createElement('div', {
                        key: `dept-${idx}`,
                        className: 'mb-3'
                    }, [
                        React.createElement('p', {
                            key: 'dept-name',
                            className: 'text-sm font-semibold text-white/90 mb-1'
                        }, dept),
                        React.createElement('ul', {
                            key: 'items',
                            className: 'text-sm text-white/70 ml-4 space-y-1'
                        }, items.map((item, itemIdx) => 
                            React.createElement('li', {
                                key: `item-${itemIdx}`,
                                className: 'list-disc'
                            }, item)
                        ))
                    ])
                );
                elements.push(React.createElement('div', {
                    key: 'departments',
                    className: 'mb-3'
                }, deptElements));
            }
            
            card.total_cost && elements.push(React.createElement('p', {
                key: 'total',
                className: 'text-sm font-semibold text-white/90 pt-2 border-t border-white/20'
            }, `💰 Total cost: ~${card.total_cost}€`));
        }
        // Weather Card
        else if (card.type === 'weather_card') {
            card.location && elements.push(React.createElement('h3', {
                key: 'location',
                className: 'font-semibold text-white text-lg mb-3'
            }, `📍 ${card.location}`));
            
            const tempDisplay = [];
            card.current_temp && tempDisplay.push(card.current_temp);
            card.feels_like && tempDisplay.push(`feels like ${card.feels_like}`);
            elements.push(React.createElement('p', {
                key: 'temp',
                className: 'text-2xl font-bold text-white mb-2'
            }, tempDisplay.join(', ')));
            
            card.condition && elements.push(React.createElement('p', {
                key: 'condition',
                className: 'text-sm text-white/80 mb-3'
            }, `${card.condition_icon ? '🌤️' : ''} ${card.condition}`));
            
            const details = [];
            card.humidity && details.push(`💧 ${card.humidity}`);
            card.wind && details.push(`💨 ${card.wind}`);
            if (details.length > 0) {
                elements.push(React.createElement('p', {
                    key: 'details',
                    className: 'text-xs text-white/60 mb-2'
                }, details.join(' • ')));
            }
            
            card.daily_forecast && elements.push(React.createElement('p', {
                key: 'forecast',
                className: 'text-sm text-white/70 mb-2'
            }, card.daily_forecast));
            
            card.clothing_advice && elements.push(React.createElement('p', {
                key: 'advice',
                className: 'text-xs text-white/60 italic'
            }, `👔 ${card.clothing_advice}`));
        }
        // Product Card
        else if (card.type === 'product_card') {
            card.title && elements.push(React.createElement('h3', {
                key: 'title',
                className: 'font-semibold text-white text-lg mb-1'
            }, card.title));
            
            card.brand && elements.push(React.createElement('p', {
                key: 'brand',
                className: 'text-sm text-white/70 mb-2'
            }, card.brand));
            
            const priceRating = [];
            card.price && priceRating.push(`💰 ${card.price}`);
            card.rating && priceRating.push(`⭐ ${card.rating}`);
            if (priceRating.length > 0) {
                elements.push(React.createElement('p', {
                    key: 'price-rating',
                    className: 'text-sm text-white/80 mb-3'
                }, priceRating.join(' • ')));
            }
            
            if (card.specifications && card.specifications.length > 0) {
                elements.push(React.createElement('ul', {
                    key: 'specs',
                    className: 'text-xs text-white/70 mb-3 ml-4 space-y-1'
                }, card.specifications.map((spec, idx) => 
                    React.createElement('li', {
                        key: `spec-${idx}`,
                        className: 'list-disc'
                    }, spec)
                )));
            }
        }
        // Generic Card
        else {
            card.title && elements.push(React.createElement('h3', {
                key: 'title',
                className: 'font-semibold text-white mb-2'
            }, card.title));
            card.subtitle && elements.push(React.createElement('p', {
                key: 'subtitle',
                className: 'text-sm text-white/70 mb-2'
            }, card.subtitle));
            
            // Render image from image_prompt (base64) or placeholder while loading
            if (card.image_prompt) {
                if (card.image_prompt.length < 1000) {
                    // Still a text prompt — image not yet generated, show placeholder
                    const aspectRatio = isTwoColumns ? '1/1' : '16/9';
                    elements.push(React.createElement(ImagePlaceholder, {
                        key: 'image',
                        aspectRatio,
                        className: 'mb-3',
                        prompt: card.image_prompt
                    }));
                } else {
                    // 2_columns: 1:1 aspect ratio, show full image
                    // 1_column: 16:9 aspect ratio, can use object-cover
                    const imageClass = isTwoColumns
                        ? 'w-full h-auto rounded-lg mb-3 object-contain aspect-square'
                        : 'w-full h-auto rounded-lg mb-3 object-cover aspect-video';

                    elements.push(React.createElement('img', {
                        key: 'image',
                        src: `data:image/png;base64,${card.image_prompt}`,
                        alt: card.title || 'Card image',
                        className: imageClass
                    }));
                }
            }
            
            card.text && elements.push(React.createElement('div', {
                key: 'text',
                className: 'text-white/80 text-sm mb-3',
                dangerouslySetInnerHTML: { __html: card.text }
            }));
        }
        
        // Buttons (common for all types)
        if (card.buttons && card.buttons.length > 0) {
            elements.push(React.createElement('div', {
                key: 'buttons',
                className: 'flex flex-wrap gap-2 mt-3'
            }, card.buttons.map((button, buttonIndex) => 
                React.createElement(ChatButton, {
                    key: `button-${buttonIndex}`,
                    button: button,
                    onExecute: onExecute,
                    cardData: card
                })
            )));
        }
        
        return elements;
    };

    return React.createElement('div', {
        className: gridClass
    }, cardGrid.cards.map((card, index) => 
        React.createElement('div', {
            key: `card-${index}`,
            className: getCardStyle(card.type)
        }, renderCardContent(card, isTwoColumns))
    ));
};

const ChatTable = ({ table }) => {
    return React.createElement('div', {
        className: 'backdrop-blur-lg bg-white/10 rounded-lg border border-white/20 shadow-xl overflow-hidden mb-4'
    }, [
        table.title && React.createElement('div', {
            key: 'table-header',
            className: 'p-4 bg-slate-800/80 border-b border-slate-700/50'
        }, React.createElement('h3', {
            className: 'font-semibold text-white'
        }, table.title)),
        React.createElement('div', {
            key: 'table-wrapper',
            className: 'overflow-x-auto'
        }, React.createElement('table', {
            className: 'w-full'
        }, [
            React.createElement('thead', {
                key: 'thead',
                className: 'bg-slate-800/50'
            }, React.createElement('tr', {}, 
                table.headers.map((header, index) => 
                    React.createElement('th', {
                        key: `header-${index}`,
                        className: 'px-4 py-3 text-left text-white font-semibold'
                    }, header)
                )
            )),
            React.createElement('tbody', {
                key: 'tbody'
            }, table.rows.map((row, rowIndex) =>
                React.createElement('tr', {
                    key: `row-${rowIndex}`,
                    className: 'border-t border-white/10 hover:bg-white/5'
                }, row.map((cell, cellIndex) =>
                    React.createElement('td', {
                        key: `cell-${cellIndex}`,
                        className: 'px-4 py-3 text-white/80'
                    }, cell)
                ))
            ))
        ]))
    ]);
};

const ImagePlaceholder = ({ aspectRatio = '16/9', className = '', prompt = '' }) => {
    return React.createElement('div', {
        className: `image-placeholder ${className}`,
        style: { aspectRatio }
    }, React.createElement('div', { className: 'image-placeholder__content' }, [
        React.createElement('span', { key: 'label', className: 'image-placeholder__label' }, 'Image is being generated'),
        prompt && React.createElement('span', { key: 'prompt', className: 'image-placeholder__prompt' }, prompt)
    ]));
};

// Colour temperature (Kelvin) -> #RRGGBB tint, so a chat light card reflects
// the bulb's real warmth. Mirrors kelvinToHex in widget.js.
const chatKelvinToHex = (kelvin) => {
    const t = kelvin / 100;
    let r, g, b;
    if (t <= 66) {
        r = 255;
        g = 99.4708025861 * Math.log(t) - 161.1195681661;
    } else {
        r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
        g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    }
    if (t >= 66) b = 255;
    else if (t <= 19) b = 0;
    else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
    const hex = v => clamp(v).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
};

const chatLightTint = (card) => {
    if (!card.is_on) return null;
    if (card.color_mode === 'color' && card.rgb_color) return card.rgb_color;
    if (card.color_mode === 'temperature' && card.color_temp) return chatKelvinToHex(card.color_temp);
    return null;
};

// AdvancedAnswerItem types that render as smart-home element cards; grouped
// into a 2-up grid by ChatUIAnswer instead of stacking full-width.
const DEVICE_CARD_TYPES = new Set(['light_card', 'light_sensor_card', 'climate_card', 'climate_sensor_card']);

// Single smart-home element card for chat (light / light sensor / radiator /
// climate sensor). Icon-in-circle on the left, primary reading on the right.
const ChatDeviceCard = ({ card, onExecute }) => {
    const accent = { light_card: 'amber', light_sensor_card: 'yellow', climate_card: 'rose', climate_sensor_card: 'teal' }[card.type] || 'white';
    const iconName = { light_card: 'lightbulb', light_sensor_card: 'sun', climate_card: 'heater', climate_sensor_card: 'thermometer' }[card.type] || 'box';

    // Left: icon circle. Right: type-specific primary reading.
    let tint = null;
    let iconColorClass = 'text-white/70';
    if (card.type === 'light_card') {
        tint = chatLightTint(card);
        if (!tint) iconColorClass = card.is_on ? 'text-amber-300' : 'text-white/40';
    }

    const reading = [];
    if (card.type === 'light_card') {
        const status = !card.is_on ? 'Off' : (card.brightness ? `On · ${card.brightness}%` : 'On');
        reading.push(React.createElement('div', { key: 'v', className: 'text-lg font-bold text-white' }, status));
    } else if (card.type === 'light_sensor_card') {
        reading.push(React.createElement('div', { key: 'v', className: 'text-lg font-bold text-white' }, `${Math.round(card.illuminance)}`));
        reading.push(React.createElement('div', { key: 'u', className: 'text-white/40 text-xs' }, 'lux'));
    } else if (card.type === 'climate_card') {
        reading.push(React.createElement('div', { key: 'v', className: 'text-lg font-bold text-white' }, `${card.target_temp}°C`));
        const sub = card.current_temp != null ? `now ${card.current_temp}°C` : (card.mode || '');
        sub && reading.push(React.createElement('div', { key: 'u', className: 'text-white/40 text-xs' }, sub));
    } else if (card.type === 'climate_sensor_card') {
        reading.push(React.createElement('div', { key: 'v', className: 'text-lg font-bold text-white' }, `${card.temperature}°C`));
        reading.push(React.createElement('div', { key: 'u', className: 'text-white/40 text-xs' }, `💧 ${card.humidity}%`));
    }

    return React.createElement('div', {
        className: `backdrop-blur-lg bg-white/10 rounded-2xl p-4 border-2 border-${accent}-500 hover:border-${accent}-400 shadow-xl shadow-${accent}-500/20 transition-all duration-300 h-full`
    }, [
        React.createElement('div', { key: 'row', className: 'flex items-center justify-between gap-3' }, [
            React.createElement('div', { key: 'left', className: 'flex items-center gap-3 min-w-0' }, [
                React.createElement('div', {
                    key: 'circle',
                    className: 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-white/10',
                    style: tint ? { backgroundColor: `${tint}33` } : undefined
                }, React.createElement('i', {
                    'data-lucide': iconName,
                    className: `w-5 h-5 ${tint ? '' : iconColorClass}`,
                    style: tint ? { color: tint } : undefined
                })),
                React.createElement('div', { key: 'meta', className: 'min-w-0' }, [
                    React.createElement('div', { key: 'name', className: 'text-white font-medium truncate' }, card.name),
                    card.room && React.createElement('div', { key: 'room', className: 'text-white/40 text-xs truncate' }, card.room)
                ])
            ]),
            React.createElement('div', { key: 'reading', className: 'text-right flex-shrink-0' }, reading)
        ]),
        card.buttons && card.buttons.length > 0 && React.createElement('div', {
            key: 'buttons',
            className: 'flex flex-wrap gap-2 mt-3'
        }, card.buttons.map((button, i) => React.createElement(ChatButton, {
            key: `dc-btn-${i}`, button, onExecute, cardData: card
        })))
    ]);
};

const ChatAdvancedAnswerItem = ({ item, onExecute }) => {
    switch (item.type) {
        case 'text_answer':
            const processedText = item.content.type === 'markdown' && typeof marked !== 'undefined'
                ? parseMarkdownWithPillLinks(item.content.text)
                : item.content.text;
            
            return React.createElement('div', {
                className: 'prose prose-invert max-w-none mb-4',
                dangerouslySetInnerHTML: { __html: processedText }
            });
        
        case 'card_grid':
            return React.createElement(ChatCardGrid, {
                cardGrid: item.content,
                onExecute: onExecute
            });
        
        case 'table':
            return React.createElement(ChatTable, {
                table: item.content
            });
        
        case 'chart':
            return React.createElement(ChatChartComponent, {
                chart: item.content,
                order: item.order
            });

        case 'map':
            return React.createElement(ChatMapComponent, {
                map: item.content
            });

        case 'image':
            const imagePrompt = item.content?.image_prompt;
            const widthClass = item.layout_hint === 'half_width' ? 'w-full md:w-1/2' :
                               item.layout_hint === 'inline' ? 'w-full md:w-1/3' :
                               'w-full';

            if (!imagePrompt) return null;

            // base64 data is hundreds of KB; text prompts are always < 1000 chars
            if (imagePrompt.length < 1000) {
                return React.createElement('div', {
                    className: `${widthClass} mx-auto mb-4`
                }, React.createElement(ImagePlaceholder, { aspectRatio: '16/9', prompt: imagePrompt }));
            }

            return React.createElement('div', {
                className: `${widthClass} mx-auto mb-4`
            }, React.createElement('img', {
                src: `data:image/png;base64,${imagePrompt}`,
                alt: item.content.alt || 'Generated image',
                className: 'w-full h-auto rounded-xl shadow-2xl'
            }));
        
        case 'event_form':
            return React.createElement(ChatEventForm, {
                content: item.content,
                onExecute: onExecute
            });
        
        case 'email_form':
            return React.createElement(ChatEmailForm, {
                content: item.content,
                onExecute: onExecute
            });
        
        case 'note_form':
            return React.createElement(ChatNoteForm, {
                content: item.content,
                onExecute: onExecute
            });

        case 'light_card':
        case 'light_sensor_card':
        case 'climate_card':
        case 'climate_sensor_card':
            return React.createElement(ChatDeviceCard, {
                card: item.content,
                onExecute: onExecute
            });

        default:
            return React.createElement('div', {
                className: 'text-white/70 mb-4'
            }, `Unsupported item type: ${item.type}`);
    }
};

const ChatUIAnswer = ({ uiAnswer, onExecute }) => {
    console.log('ChatUIAnswer: Rendering ui_answer', uiAnswer);
    console.log('ChatUIAnswer: items count', uiAnswer?.items?.length);
    
    const processIntroText = (introText) => {
        if (!introText) return null;
        
        const processedText = introText.type === 'markdown' && typeof marked !== 'undefined'
            ? parseMarkdownWithPillLinks(introText.text)
            : introText.text;
        
        return React.createElement('div', {
            key: 'intro',
            className: 'prose prose-invert max-w-none mb-4',
            dangerouslySetInnerHTML: { __html: processedText }
        });
    };

    const items = uiAnswer?.items || [];
    console.log('ChatUIAnswer: Processing items', items);

    // Smart-home element cards are individual items, but should tile 2-up rather
    // than stack full-width. Collapse each run of consecutive device-card items
    // into a grid-cols-2 row; a lone card stays full-width. Everything else
    // renders one-per-block as before.
    const sorted = items.slice().sort((a, b) => a.order - b.order);
    const renderedItems = [];
    for (let i = 0; i < sorted.length;) {
        const item = sorted[i];
        if (DEVICE_CARD_TYPES.has(item.type)) {
            const group = [];
            while (i < sorted.length && DEVICE_CARD_TYPES.has(sorted[i].type)) {
                group.push(sorted[i]);
                i++;
            }
            const inner = group.length > 1
                ? React.createElement('div', {
                    className: 'grid grid-cols-2 gap-3'
                }, group.map((g, gi) => React.createElement(ChatAdvancedAnswerItem, {
                    key: `card-${gi}`, item: g, onExecute
                })))
                : React.createElement(ChatAdvancedAnswerItem, {
                    item: group[0], onExecute
                });
            renderedItems.push(React.createElement('div', {
                key: `group-${i}`,
                className: getSpacingClass(group[0].spacing)
            }, inner));
        } else {
            renderedItems.push(React.createElement('div', {
                key: `item-${i}`,
                className: getSpacingClass(item.spacing)
            }, React.createElement(ChatAdvancedAnswerItem, {
                item, onExecute
            })));
            i++;
        }
    }

    return React.createElement('div', {
        className: 'space-y-6'
    }, [
        // Intro text
        processIntroText(uiAnswer.intro_text),

        // Items
        React.createElement('div', {
            key: 'items'
        }, renderedItems),

        // Quick action buttons
        uiAnswer.quick_action_buttons && React.createElement('div', {
            key: 'quick-actions',
            className: 'flex flex-wrap gap-3 pt-4 border-t border-white/20'
        }, uiAnswer.quick_action_buttons.buttons.map((button, index) =>
            React.createElement(ChatButton, {
                key: `quick-${index}`,
                button: button,
                onExecute: onExecute
            })
        ))
    ]);
};

const StreamingStatusInline = ({ message, step }) => {
    const { useEffect } = React;

    useEffect(() => {
        if (typeof lucide !== 'undefined') {
            setTimeout(() => lucide.createIcons(), 0);
        }
    }, [step]);

    const toolIconMap = {
        'web_search': 'search', 'google': 'search', 'search': 'search',
        'llm': 'brain', 'think': 'brain', 'reason': 'brain',
        'image': 'image', 'fetch': 'globe', 'browse': 'globe', 'web': 'globe',
        'memory': 'database', 'plan': 'list-checks', 'tool': 'wrench',
        'code': 'code-2', 'file': 'file-text',
    };
    const getIcon = (s) => {
        if (!s) return 'zap';
        const lower = s.toLowerCase();
        for (const [key, icon] of Object.entries(toolIconMap)) {
            if (lower.includes(key)) return icon;
        }
        return 'zap';
    };

    return React.createElement('div', {
        className: 'flex items-center gap-2 mb-4 pb-3 border-b border-white/10'
    }, [
        React.createElement('div', {
            key: 'pulse',
            className: 'relative flex-shrink-0 w-2 h-2'
        }, [
            React.createElement('div', { key: 'ring', className: 'absolute inset-0 rounded-full bg-blue-400/50 animate-ping' }),
            React.createElement('div', { key: 'dot', className: 'absolute inset-0 rounded-full bg-blue-400' })
        ]),
        React.createElement('i', {
            key: 'icon',
            'data-lucide': getIcon(step),
            className: 'w-3.5 h-3.5 text-white/40 flex-shrink-0'
        }),
        React.createElement('span', {
            key: 'text',
            className: 'text-white/50 text-xs truncate'
        }, message || 'Processing...')
    ]);
};

const StreamingPlaceholder = ({ reasoning, statusMessage, statusStep, introText }) => {
    return React.createElement('div', {
        className: 'space-y-4'
    }, [
        statusMessage && React.createElement(StreamingStatusInline, {
            key: 'status',
            message: statusMessage,
            step: statusStep
        }),
        reasoning && React.createElement('div', {
            key: 'reasoning',
            className: 'text-white/50 text-xs italic border-l-2 border-white/20 pl-3 mb-3'
        }, reasoning),
        introText
            ? React.createElement('div', {
                key: 'intro-text',
                className: 'prose prose-invert max-w-none streaming-markdown',
                dangerouslySetInnerHTML: { __html: parseMarkdownWithPillLinks(introText) + '<span class="streaming-cursor"></span>' }
              })
            : React.createElement('div', {
                key: 'skeleton-lines',
                className: 'space-y-2'
              }, [
                React.createElement('div', { key: 's1', className: 'skeleton-line', style: { width: '75%' } }),
                React.createElement('div', { key: 's2', className: 'skeleton-line', style: { width: '100%' } }),
                React.createElement('div', { key: 's3', className: 'skeleton-line', style: { width: '83%' } }),
              ]),
        React.createElement('div', {
            key: 'skeleton-cards',
            className: 'grid grid-cols-2 gap-3 mt-3'
        }, [
            React.createElement('div', { key: 'c1', className: 'skeleton-card', style: { height: '6rem' } }),
            React.createElement('div', { key: 'c2', className: 'skeleton-card', style: { height: '6rem' } }),
        ])
    ]);
};

const ChatContent = ({ content, onExecute }) => {

    if (content._streaming && !content._placeholder) {
        const isFormattedStream = content.content_format === 'formatted' || content.content_format === 'level2_answer';
        const streamText = content.text || '';
        return React.createElement('div', { className: 'space-y-0' }, [
            content._statusMessage && React.createElement(StreamingStatusInline, {
                key: 'status',
                message: content._statusMessage,
                step: content._statusStep || ''
            }),
            isFormattedStream && typeof marked !== 'undefined'
                ? React.createElement('div', {
                    key: 'text',
                    className: 'prose prose-invert max-w-none streaming-markdown',
                    dangerouslySetInnerHTML: { __html: parseMarkdownWithPillLinks(streamText) + '<span class="streaming-cursor"></span>' }
                  })
                : React.createElement('div', {
                    key: 'text',
                    className: 'prose prose-invert max-w-none'
                  }, [
                    React.createElement('span', { key: 'text' }, streamText),
                    React.createElement('span', { key: 'cursor', className: 'streaming-cursor' })
                  ])
        ]);
    }

    if (content._placeholder) {
        return React.createElement(StreamingPlaceholder, {
            key: 'placeholder',
            reasoning: content._reasoning || '',
            statusMessage: content._statusMessage || '',
            statusStep: content._statusStep || '',
            introText: content.text || ''
        });
    }

    // Check for ui_answer first, regardless of content_format
    if (content.ui_answer) {
        console.log('ChatContent: Rendering ui_answer');
        return React.createElement(ChatUIAnswer, {
            uiAnswer: content.ui_answer,
            onExecute: onExecute
        });
    }
    
    // Check for level3_answer (text + widget + quick actions)
    if (content.level3_answer) {
        console.log('ChatContent: Rendering level3_answer');
        const l3 = content.level3_answer;
        return React.createElement('div', {
            className: 'space-y-6'
        }, [
            // Text
            l3.text && React.createElement('div', {
                key: 'text',
                className: 'prose prose-invert max-w-none',
                dangerouslySetInnerHTML: { 
                    __html: l3.text.type === 'markdown' && typeof marked !== 'undefined'
                        ? parseMarkdownWithPillLinks(l3.text.text)
                        : l3.text.text
                }
            }),
            // Widget (music_widget, etc.)
            l3.widget && renderContentWidget(l3.widget),
            // Quick action buttons
            l3.quick_action_buttons && React.createElement('div', {
                key: 'quick-actions',
                className: 'flex flex-wrap gap-3 pt-4 border-t border-white/20'
            }, l3.quick_action_buttons.buttons.map((button, index) =>
                React.createElement(ChatButton, {
                    key: `quick-${index}`,
                    button: button,
                    onExecute: onExecute
                })
            ))
        ]);
    }
    
    // Check for level2_answer (text + quick actions)
    if (content.level2_answer) {
        const l2 = content.level2_answer;
        return React.createElement('div', {
            className: 'space-y-6'
        }, [
            // Text
            l2.text && React.createElement('div', {
                key: 'text',
                className: 'prose prose-invert max-w-none',
                dangerouslySetInnerHTML: {
                    __html: l2.text.type === 'markdown' && typeof marked !== 'undefined'
                        ? parseMarkdownWithPillLinks(l2.text.text)
                        : l2.text.text
                }
            }),
            // Quick action buttons
            l2.quick_action_buttons && React.createElement('div', {
                key: 'quick-actions',
                className: 'flex flex-wrap gap-3 pt-4 border-t border-white/20'
            }, l2.quick_action_buttons.buttons.map((button, index) =>
                React.createElement(ChatButton, {
                    key: `quick-${index}`,
                    button: button,
                    onExecute: onExecute
                })
            ))
        ]);
    }
    
    // Then check for text content
    if (content.text) {
        // Simple text content - check if it needs markdown processing
        const processedText = content.content_format === 'markdown' && typeof marked !== 'undefined'
            ? parseMarkdownWithPillLinks(content.text)
            : content.text;
        
        return React.createElement('div', {
            className: 'prose prose-invert max-w-none',
            dangerouslySetInnerHTML: { __html: processedText }
        });
    }

    console.error('ChatContent: Unsupported content format', content);
    return React.createElement('div', {
        className: 'text-white/70'
    }, 'Unsupported content format');
};

// Fullscreen viewer for user-attached images. Uses inline SVG icons (not lucide <i>)
// so React reconciliation is not broken by lucide.createIcons() swapping nodes.
const ImageLightbox = ({ images, startIndex, onClose }) => {
    const { useState, useEffect, useCallback } = React;
    const [index, setIndex] = useState(startIndex);
    const hasMany = images.length > 1;

    const step = useCallback((delta) => {
        setIndex(i => (i + delta + images.length) % images.length);
    }, [images.length]);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowLeft' && hasMany) step(-1);
            else if (e.key === 'ArrowRight' && hasMany) step(1);
        };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [onClose, step, hasMany]);

    const icon = (d) => React.createElement('svg', {
        viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: 'w-5 h-5'
    }, React.createElement('path', { d }));

    const navBtn = (cls, label, delta, d) => React.createElement('button', {
        key: cls, type: 'button', className: `lightbox__btn ${cls}`, title: label, 'aria-label': label,
        onClick: (e) => { e.stopPropagation(); step(delta); }
    }, icon(d));

    return ReactDOM.createPortal(
        React.createElement('div', {
            className: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Image preview',
            onClick: onClose
        }, [
            React.createElement('img', {
                key: 'img', src: images[index], alt: 'Attached image', className: 'lightbox__img',
                onClick: (e) => e.stopPropagation()
            }),
            React.createElement('button', {
                key: 'close', type: 'button', className: 'lightbox__btn lightbox__btn--close',
                title: 'Close', 'aria-label': 'Close', onClick: (e) => { e.stopPropagation(); onClose(); }
            }, icon('M18 6 6 18M6 6l12 12')),
            hasMany && navBtn('lightbox__btn--prev', 'Previous image', -1, 'M15 18l-6-6 6-6'),
            hasMany && navBtn('lightbox__btn--next', 'Next image', 1, 'M9 18l6-6-6-6'),
            hasMany && React.createElement('div', {
                key: 'counter', className: 'lightbox__counter'
            }, `${index + 1} / ${images.length}`)
        ]),
        document.body
    );
};

const ChatMessage = ({ message, onExecute }) => {
    const { useState, useRef, useEffect } = React;
    const isUser = message.role === 'user';
    const containerRef = useRef(null);
    const [lightboxIndex, setLightboxIndex] = useState(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Render mermaid diagrams: replace <pre><code class="language-mermaid"> with <div class="mermaid">
        if (typeof mermaid !== 'undefined') {
            const mermaidBlocks = containerRef.current.querySelectorAll('code.language-mermaid');
            mermaidBlocks.forEach(block => {
                const pre = block.parentElement;
                const container = document.createElement('div');
                container.className = 'mermaid';
                container.textContent = block.textContent;
                pre.replaceWith(container);
            });
            const mermaidNodes = containerRef.current.querySelectorAll('.mermaid');
            if (mermaidNodes.length > 0) {
                mermaid.run({ nodes: mermaidNodes });
            }
        }

    }, [message]);
    const [debugOpen, setDebugOpen] = useState(false);
    const hasDebugData = message.llm_trace || (message.pipeline_steps && message.pipeline_steps.length > 0) || message.pipeline_trace;
    const showDebugButton = window.debugMode && hasDebugData;

    // ── Saved voice recording (message.has_audio) ──────────────────────────
    // Plays the stored recording — the user's spoken input or the assistant's TTS
    // answer — captured when the turn went through a voice channel.
    const [isPlayingAudio, setIsPlayingAudio] = useState(false);
    const audioElRef = useRef(null);
    const hasRecording = !!message.has_audio;

    const handlePlayRecording = () => {
        let el = audioElRef.current;
        if (isPlayingAudio && el) { el.pause(); return; }
        if (!el) {
            el = new Audio(`/ai-assistant/api/messages/${message.message_id}/audio/`);
            el.onplay = () => setIsPlayingAudio(true);
            el.onpause = () => setIsPlayingAudio(false);
            el.onended = () => setIsPlayingAudio(false);
            el.onerror = () => setIsPlayingAudio(false);
            audioElRef.current = el;
        }
        el.play().catch((e) => {
            console.error('ChatMessage: recording playback failed', e);
            setIsPlayingAudio(false);
        });
    };

    // ── Text-to-speech (browser SpeechSynthesis) ───────────────────────────
    const [isSpeaking, setIsSpeaking] = useState(false);
    const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

    // Extract only the main narrative text — the markdown/prose blocks — skipping
    // cards, widgets and action buttons (which are rendered outside .prose).
    const getSpeakText = () => {
        const dom = containerRef.current?.querySelector('.message-content');
        if (dom) {
            const proseText = Array.from(dom.querySelectorAll('.prose'))
                .map(el => el.innerText?.trim())
                .filter(Boolean)
                .join('\n');
            if (proseText) return proseText;
        }

        const content = message.content;
        if (typeof content === 'string') return content;
        return content?.text
            || content?.level2_answer?.text?.text
            || content?.level3_answer?.text?.text
            || content?.ui_answer?.text?.text
            || '';
    };

    // Detect language from the text (Cyrillic → Russian, otherwise English)
    const detectLang = (text) => (/[Ѐ-ӿ]/.test(text) ? 'ru-RU' : 'en-US');

    // Pick the best available voice for a BCP-47 lang tag (e.g. 'ru-RU')
    const pickVoice = (lang) => {
        const voices = window.speechSynthesis.getVoices() || [];
        const prefix = lang.split('-')[0];
        return voices.find(v => v.lang === lang)
            || voices.find(v => v.lang?.toLowerCase().startsWith(prefix))
            || null;
    };

    const handlePlay = () => {
        if (!ttsSupported) {
            console.warn('SpeechSynthesis is not supported in this browser');
            return;
        }
        // Toggle: stop if this message is already speaking
        if (isSpeaking) {
            window.speechSynthesis.cancel();
            setIsSpeaking(false);
            return;
        }
        const text = getSpeakText();
        if (!text) return;
        // Cancel any other in-flight speech before starting this one
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        const lang = detectLang(text);
        utterance.lang = lang;
        const voice = pickVoice(lang);
        if (voice) utterance.voice = voice;
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
        setIsSpeaking(true);
    };

    // Refresh icons when playback state changes.
    useEffect(() => {
        if (typeof lucide !== 'undefined') {
            setTimeout(() => lucide.createIcons(), 0);
        }
    }, [isSpeaking, isPlayingAudio]);

    // Stop any playback on unmount only — must NOT run on state changes, or it
    // would pause the recording right as it starts (AbortError) and re-render.
    useEffect(() => {
        return () => {
            if (ttsSupported) {
                try { window.speechSynthesis.cancel(); } catch (_) { /* noop */ }
            }
            try { audioElRef.current?.pause?.(); } catch (_) { /* noop */ }
        };
    }, []);

    const renderDebugPanel = () => {
        const pt = message.pipeline_trace;
        const topTrace = message.llm_trace;
        const hasTopTraceData = topTrace && (topTrace.total_tokens > 0 || topTrace.total_cost > 0);

        // Aggregate LLM trace from stages when top-level is empty (frontend fallback, not new data)
        const stageLlmTraces = pt
            ? ['command_call', 'tool_execution', 'create_output']
                .filter(k => pt[k]?.llm_trace)
                .map(k => ({ stage: k, trace: pt[k].llm_trace }))
            : [];
        const aggregated = stageLlmTraces.length > 0
            ? stageLlmTraces.reduce((acc, { trace }) => ({
                model: acc.model || trace.model,
                input_tokens: (acc.input_tokens || 0) + (trace.input_tokens || 0),
                input_tokens_details: {
                    cached_tokens: ((acc.input_tokens_details?.cached_tokens) || 0) + ((trace.input_tokens_details?.cached_tokens) || 0),
                },
                output_tokens: (acc.output_tokens || 0) + (trace.output_tokens || 0),
                output_tokens_details: {
                    reasoning_tokens: ((acc.output_tokens_details?.reasoning_tokens) || 0) + ((trace.output_tokens_details?.reasoning_tokens) || 0),
                },
                total_tokens: (acc.total_tokens || 0) + (trace.total_tokens || 0),
                total_cost: (acc.total_cost || 0) + (trace.total_cost || 0),
            }), {})
            : null;
        const effectiveLlmTrace = hasTopTraceData ? topTrace : (aggregated || topTrace);
        // model may be missing from top-level trace — fall back to stage model
        const effectiveModel = effectiveLlmTrace?.model || aggregated?.model || stageLlmTraces[0]?.trace?.model || '—';

        // ── helpers ─────────────────────────────────────────────────────────────
        const H = (key, label) => React.createElement('div', {
            key,
            className: 'uppercase tracking-wider text-[10px] mt-3 mb-1'
        }, label);

        const Row = (key, label, value) => React.createElement('div', {
            key,
            className: 'flex justify-between gap-4 leading-[1.6]'
        }, [
            React.createElement('span', { key: 'l' }, label),
            React.createElement('span', { key: 'r' }, value),
        ]);

        const Sub = (key, value) => React.createElement('div', {
            key,
            className: 'text-right leading-[1.4] -mt-0.5 mb-0.5 text-[11px]'
        }, value);

        const HR = (key) => React.createElement('div', {
            key, className: 'border-t border-white/10 mt-2 mb-2'
        });

        const sec = (n) => `${(n / 1000).toFixed(2)}s`;

        // ── MESSAGE ────────────────────────────────────────────────────────────
        const idSection = message.message_id && [
            H('id-hdr', 'Message'),
            Row('msg-id', 'id', String(message.message_id)),
        ];

        // ── LLM TRACE ──────────────────────────────────────────────────────────
        const lm = effectiveLlmTrace;
        const cached = lm?.input_tokens_details?.cached_tokens || 0;
        const reasoning = lm?.output_tokens_details?.reasoning_tokens || 0;
        const llmSection = lm && [
            H('llm-hdr', 'LLM Trace'),
            Row('lm-model',  'model',  effectiveModel),
            Row('lm-input',  'input',  `${lm.input_tokens || 0} tokens`),
            cached > 0   && Sub('lm-cached',    `↳ cached: ${cached}`),
            Row('lm-output', 'output', `${lm.output_tokens || 0} tokens`),
            reasoning > 0 && Sub('lm-reasoning', `↳ reasoning: ${reasoning}`),
            Row('lm-total',  'total',  `${lm.total_tokens || 0} tokens`),
            Row('lm-cost',   'cost',   `$${(lm.total_cost || 0).toFixed(6)}`),
        ].filter(Boolean);

        // ── TIMELINE  (command_call → tool_execution → create_output) ──────────
        const traceSection = pt && [
            HR('div1'),
            H('tl-hdr', 'Timeline'),
            ...['command_call', 'tool_execution', 'create_output'].map(k => {
                const stage = pt[k];
                if (!stage) return Row(k, k, '—');
                const stageLm = stage.llm_trace;
                const hasLm = stageLm && stageLm.total_tokens > 0;
                return [
                    Row(k, k, sec(stage.duration_ms)),
                    stage.ttft_ms != null && Row(`${k}-ttft`, 'time to first token', sec(stage.ttft_ms)),
                    hasLm && Sub(`${k}-lm`, `↳ ${stageLm.input_tokens}→${stageLm.output_tokens} tok · $${(stageLm.total_cost || 0).toFixed(6)}`),
                ].filter(Boolean);
            }).flat(),
            HR('div2'),
            Row('total', 'total', sec(pt.total_ms)),
            pt.ttft_ms != null && Row('pipeline-ttft', 'time to first token', sec(pt.ttft_ms)),
        ];

        // ── STEPS  (deduplicated: group by name, sum durations) ────────────────
        const rawSteps = message.pipeline_steps || [];
        const stepsMap = rawSteps.reduce((acc, s) => {
            const name = s.step || s.status || '?';
            acc[name] = (acc[name] || 0) + (s.duration_ms || 0);
            return acc;
        }, {});
        const dedupedSteps = Object.entries(stepsMap);
        const stepsSection = dedupedSteps.length > 0 && [
            HR('div3'),
            H('steps-hdr', 'Steps'),
            ...dedupedSteps.map(([name, dur], i) => Row(`step-${i}`, name, sec(dur))),
        ];

        return React.createElement('div', {
            key: 'debug-panel',
            className: 'mt-2 bg-black/40 border border-white/10 rounded-xl p-3 text-xs font-mono'
        }, [
            ...(idSection    || []),
            ...(llmSection   || []),
            ...(traceSection || []),
            ...(stepsSection || []),
        ]);
    };

    return React.createElement('div', {
        className: `mb-6 flex ${isUser ? 'justify-end' : 'justify-start'}`,
        ref: containerRef
    }, [
        React.createElement('div', {
            key: 'message-container',
            className: `group/msg ${isUser ? 'max-w-[85%]' : 'w-[85%]'} ${isUser ? 'order-2' : 'order-1'}`
        }, [
            React.createElement('div', {
                key: 'message-bubble',
                className: `backdrop-blur-lg rounded-3xl p-6 border shadow-2xl relative group ${
                    isUser
                        ? 'bg-gradient-to-r from-slate-600 to-slate-700 border-slate-500/30 text-white'
                        : 'bg-white/10 border-white/20 text-white'
                }`
            }, [
                React.createElement('div', {
                    key: 'message-header',
                    className: 'flex items-center gap-2 mb-3'
                }, [
                    React.createElement('div', {
                        key: 'avatar',
                        className: `w-8 h-8 rounded-full flex items-center justify-center ${
                            isUser ? 'bg-slate-500' : 'bg-blue-500'
                        }`
                    }, [
                        React.createElement('i', {
                            key: 'avatar-icon',
                            'data-lucide': isUser ? 'user' : 'bot',
                            className: 'w-4 h-4'
                        })
                    ]),
                    React.createElement('span', {
                        key: 'role',
                        className: 'font-semibold'
                    }, isUser ? 'You' : 'Archie'),
                    React.createElement('span', {
                        key: 'time',
                        className: 'text-xs opacity-70'
                    }, formatTime(message.created_at)),
                    // Voice recording control — a compact round play/pause button in
                    // the header corner; morphs into an animated equalizer while playing.
                    hasRecording && React.createElement('button', {
                        key: 'voice-play',
                        type: 'button',
                        onClick: handlePlayRecording,
                        title: isPlayingAudio ? 'Pause voice' : 'Play voice',
                        'aria-label': isPlayingAudio ? 'Pause voice' : 'Play voice',
                        className: `voice-play-btn ml-auto shrink-0 w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-200 ${
                            isPlayingAudio
                                ? 'bg-cyan-500/25 border-cyan-300/50 text-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.45)]'
                                : 'bg-white/5 border-white/15 text-white/55 hover:text-white hover:bg-white/10 hover:border-white/30 hover:scale-105 active:scale-95'
                        }`
                    }, isPlayingAudio
                        ? React.createElement('span', {
                            key: 'eq', className: 'voice-eq', 'aria-hidden': 'true'
                        }, [0, 1, 2].map(i => React.createElement('span', { key: i })))
                        // Inline SVG (not a lucide <i>): lucide.createIcons() would
                        // swap the <i> for an <svg> outside React, and toggling to the
                        // equalizer then crashes reconciliation (removeChild), blanking
                        // the whole chat.
                        : React.createElement('svg', {
                            key: 'play',
                            viewBox: '0 0 24 24',
                            fill: 'currentColor',
                            'aria-hidden': 'true',
                            className: 'w-3.5 h-3.5 translate-x-[1px]'
                        }, React.createElement('path', { d: 'M8 5v14l11-7z' })))
                ]),
                message._attachments && message._attachments.length > 0 && React.createElement('div', {
                    key: 'attachments',
                    className: `attachments attachments--${Math.min(message._attachments.length, 4)}`
                }, message._attachments.map((src, i) => React.createElement('button', {
                    key: i,
                    type: 'button',
                    className: 'attachment-thumb',
                    title: 'Click to enlarge',
                    'aria-label': `Enlarge image ${i + 1}`,
                    onClick: () => setLightboxIndex(i)
                }, React.createElement('img', {
                    src: src,
                    alt: 'Attached image',
                    loading: 'lazy',
                    draggable: false
                })))),
                message._files && message._files.length > 0 && React.createElement('div', {
                    key: 'files',
                    className: 'flex flex-col gap-1.5 mb-2'
                }, message._files.map((f, i) => React.createElement('a', {
                    key: i,
                    href: f.url,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    download: /\.pdf$/i.test(f.name) ? undefined : f.name,
                    className: 'file-chip file-chip--link',
                    title: f.name
                }, [
                    React.createElement('svg', {
                        key: 'icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
                        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
                        className: 'w-4 h-4 shrink-0 text-cyan-300'
                    }, [
                        React.createElement('path', { key: 'a', d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }),
                        React.createElement('path', { key: 'b', d: 'M14 3v5h5' })
                    ]),
                    React.createElement('span', { key: 'name', className: 'file-chip__name' }, f.name),
                    React.createElement('span', { key: 'size', className: 'file-chip__size' },
                        f.size < 1024 ? `${f.size} B` : f.size < 1048576 ? `${Math.round(f.size / 1024)} KB` : `${(f.size / 1048576).toFixed(1)} MB`)
                ]))),
                lightboxIndex !== null && message._attachments && React.createElement(ImageLightbox, {
                    key: 'lightbox',
                    images: message._attachments,
                    startIndex: lightboxIndex,
                    onClose: () => setLightboxIndex(null)
                }),
                React.createElement('div', {
                    key: 'message-content',
                    className: 'message-content'
                }, React.createElement(ChatContent, {
                    content: message.content,
                    onExecute: onExecute
                }))
            ]),
            // Message actions (stub) — appear on hover, aligned right
            React.createElement('div', {
                key: 'message-actions',
                className: 'flex justify-end gap-1 mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity'
            }, [
                ttsSupported && React.createElement('button', {
                    key: 'play-btn',
                    type: 'button',
                    className: `transition-colors p-1.5 rounded-lg hover:bg-white/10 ${
                        isSpeaking ? 'text-cyan-400 hover:text-cyan-300' : 'text-white/40 hover:text-white/80'
                    }`,
                    title: isSpeaking ? 'Stop playback' : 'Play message',
                    'aria-label': isSpeaking ? 'Stop playback' : 'Play message',
                    onClick: handlePlay
                }, React.createElement('i', {
                    key: 'icon',
                    'data-lucide': isSpeaking ? 'square' : 'volume-2',
                    className: 'w-4 h-4'
                })),
                React.createElement('button', {
                    key: 'more-btn',
                    type: 'button',
                    className: 'text-white/40 hover:text-white/80 transition-colors p-1.5 rounded-lg hover:bg-white/10',
                    title: 'More actions',
                    'aria-label': 'More actions',
                    onClick: () => console.log('More actions clicked')
                }, React.createElement('i', {
                    key: 'icon',
                    'data-lucide': 'more-horizontal',
                    className: 'w-4 h-4'
                }))
            ]),
            showDebugButton && React.createElement('div', {
                key: 'debug-toggle',
                className: `flex ${isUser ? 'justify-end' : 'justify-start'} mt-1`
            }, React.createElement('button', {
                className: 'text-white/30 hover:text-white/60 transition-colors text-xs flex items-center gap-1 px-2 py-0.5',
                onClick: () => setDebugOpen(prev => !prev)
            }, [
                React.createElement('i', {
                    key: 'icon',
                    'data-lucide': debugOpen ? 'chevron-down' : 'chevron-right',
                    className: 'w-3 h-3'
                }),
                React.createElement('span', { key: 'label' }, 'debug')
            ])),
            showDebugButton && debugOpen && renderDebugPanel()
        ])
    ]);
};
