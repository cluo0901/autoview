// XMLHttpRequest utility to replace fetch for Safari compatibility
function xhrRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const method = options.method || 'GET';
        
        xhr.open(method, url, true);
        
        // Set headers
        if (options.headers) {
            for (const [key, value] of Object.entries(options.headers)) {
                xhr.setRequestHeader(key, value);
            }
        }
        
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                const response = {
                    ok: xhr.status >= 200 && xhr.status < 300,
                    status: xhr.status,
                    statusText: xhr.statusText,
                    json: function() {
                        return Promise.resolve(JSON.parse(xhr.responseText));
                    },
                    text: function() {
                        return Promise.resolve(xhr.responseText);
                    }
                };
                
                if (response.ok) {
                    resolve(response);
                } else {
                    reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
                }
            }
        };
        
        xhr.onerror = function() {
            reject(new Error('Network error'));
        };
        
        xhr.ontimeout = function() {
            reject(new Error('Request timeout'));
        };
        
        // Set timeout
        xhr.timeout = options.timeout || 10000;
        
        // Send request
        const body = options.body || null;
        xhr.send(body);
    });
}

// Replace fetch with xhr for Safari compatibility
if (typeof window !== 'undefined') {
    window.safeFetch = xhrRequest;
}