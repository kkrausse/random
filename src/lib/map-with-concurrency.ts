export async function mapWithConcurrency<T, TResult>(
	items: readonly T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
	if (!Number.isInteger(concurrency) || concurrency < 1)
		throw new Error("concurrency must be a positive integer");

	const results = Array<TResult>(items.length);
	let nextIndex = 0;
	const worker = async () => {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await mapper(items[index] as T, index);
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, worker),
	);
	return results;
}
