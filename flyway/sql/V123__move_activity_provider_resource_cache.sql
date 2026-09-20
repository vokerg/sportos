-- V121 introduced the cache in the primary database as a safe first step.
-- The cache now has its own database; it is derived and can be rebuilt lazily.

DROP TABLE IF EXISTS activity_provider_resources;
