/**
 * src/utils/network.js
 * Centralized fetch handler with 3-strike retries and Concurrent Batching.
 */

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Robust fetch wrapper to prevent infinite 429 loops.
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    let attempts = 0;

    while (attempts < maxRetries) {
        try {
            const response = await fetch(url, options);

            // 1. Handle Rate Limits Gracefully
            if (response.status === 429) {
                attempts++;
                const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
                console.warn(`⚠️ [429 Rate Limit] on ${url}. Retrying in ${retryAfter}s (Attempt ${attempts}/${maxRetries})...`);
                await delay(retryAfter * 1000);
                continue; // Loop again
            }

            // 2. Handle standard HTTP errors
            if (!response.ok) {
                // We return null for 404s (e.g., Player not found/Name changed) so the engine can handle it.
                if (response.status === 404) return { status: 404, data: null };
                throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
            }

            // 3. Success (or 204 No Content for Discord)
            if (response.status === 204) return { status: 204, data: true };
            
            const data = await response.json();
            return { status: 200, data };

        } catch (error) {
            attempts++;
            console.error(`❌ [Network Error] ${url} -> ${error.message} (Attempt ${attempts}/${maxRetries})`);
            if (attempts >= maxRetries) return { status: 500, data: null };
            await delay(2000); // Wait 2s before retrying a hard crash
        }
    }
    return { status: 500, data: null };
}

/**
 * Processes an array of items concurrently in batches to respect rate limits.
 * Solves the "13 Minute Execution" bottleneck.
 */
async function processInBatches(items, batchSize, delayBetweenBatchesMs, processorCallback) {
    let results = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        
        // Run the batch concurrently
        const batchResults = await Promise.all(batch.map(item => processorCallback(item)));
        results.push(...batchResults);
        
        // Wait before sending the next batch (unless it's the last batch)
        if (i + batchSize < items.length) {
            await delay(delayBetweenBatchesMs);
        }
    }
    
    return results;
}

module.exports = { fetchWithRetry, processInBatches };
