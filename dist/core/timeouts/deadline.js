export class TimeoutError extends Error {
    kind;
    timeoutMs;
    constructor(kind, timeoutMs, message) {
        super(message ?? `${kind} timed out after ${timeoutMs}ms`);
        this.name = 'TimeoutError';
        this.kind = kind;
        this.timeoutMs = timeoutMs;
    }
}
export function withDeadline(options, task) {
    const controller = new AbortController();
    let timer;
    return new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new TimeoutError(options.kind, options.ms, options.message));
        }, options.ms);
        Promise.resolve()
            .then(() => task(controller.signal))
            .then((value) => {
            if (timer !== undefined)
                clearTimeout(timer);
            resolve(value);
        }, (error) => {
            if (timer !== undefined)
                clearTimeout(timer);
            reject(error);
        });
    });
}
export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=deadline.js.map