import { v4 as uuidv4 } from "uuid";
import { Redis } from "ioredis";

export class RedisMutexAcquisitionError extends Error {
	readonly lockName: string;
	readonly lockId: string;

	constructor({ lockName, lockId }: { lockName: string; lockId: string }) {
		super(
			`Failed to acquire redis mutex with name '${lockName}' (id: ${lockId})`,
		);
		this.lockName = lockName;
		this.lockId = lockId;
	}
}

interface RedisOptimisticLockOptions {
	maxWaitTime: number;
	maxAttempts?: number;
	timeBetweenAttempts?: number;
}

type SlimRedisClient = Pick<Redis, 'set' | 'del' | 'eval'>;

export class RedisMutex {
	readonly #name: string;
	readonly #id: string;
	readonly #timeout: number;
	readonly #redisClient: SlimRedisClient;

	constructor({
		name,
		id,
		timeout,
		redisClient,
	}: {
		name: string;
		id: string;
		timeout: number;
		redisClient: SlimRedisClient;
	}) {
		this.#name = name;
		this.#id = id;
		this.#timeout = timeout;
		this.#redisClient = redisClient;
	}

	getRedisKey() {
		return `lock:${this.#name}:${this.#id}`;
	}

	async forceResetLock() {
		await this.#redisClient.del(this.getRedisKey());
	}

	async #obtainLock() {
		const lockKey = this.getRedisKey();
		const lockerId = uuidv4();

		const result = await this.#redisClient.set(
			lockKey,
			lockerId,
			"PX",
			this.#timeout,
			"NX",
		);
		if (!result) {
			return null;
		}

		return lockerId;
	}

	async #releaseLock(lockerId: string) {
		await this.#redisClient.eval(
			[
				'if redis.call("get", KEYS[1]) == ARGV[1] then',
				'  return redis.call("del", KEYS[1])',
				"else",
				"  return 0",
				"end",
			].join(" "),
			1,
			this.getRedisKey(),
			lockerId,
		);
	}

	async #obtainLockOptimistically({
		timeBetweenAttempts,
		maxWaitTime,
		maxAttempts,
	}: RedisOptimisticLockOptions) {
		maxAttempts ??= Infinity;
		const start = Date.now();
		const spinTime =
			timeBetweenAttempts ?? Math.max(10, Math.floor(maxWaitTime / 2));

		while (true) {
			const lockerId = await this.#obtainLock();
			if (lockerId) {
				return lockerId;
			}

			const elapsed = Date.now() - start;
			if (elapsed > maxWaitTime) {
				return null;
			}

			await new Promise((resolve) => setTimeout(resolve, spinTime));
		}
	}

	async withLock<T>(run: () => Promise<T>): Promise<T> {
		const lockerId = await this.#obtainLock();
		if (!lockerId) {
			throw new RedisMutexAcquisitionError({
				lockName: this.#name,
				lockId: this.#id,
			});
		}

		try {
			return await run();
		} finally {
			await this.#releaseLock(lockerId);
		}
	}

	async withOptimisticLock<T>(
		run: () => Promise<T>,
		options: RedisOptimisticLockOptions,
	): Promise<T> {
		const lockerId = await this.#obtainLockOptimistically(options);
		if (!lockerId) {
			throw new RedisMutexAcquisitionError({
				lockName: this.#name,
				lockId: this.#id,
			});
		}

		try {
			return await run();
		} finally {
			await this.#releaseLock(lockerId);
		}
	}
}
