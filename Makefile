.PHONY: config services build dev health logs stop test

config:
	docker compose config --quiet

services:
	docker compose up -d postgres redis

build:
	docker compose build api
	docker compose build web

dev:
	docker compose up -d

health:
	docker compose ps
	docker compose exec -T web wget -q -O - http://127.0.0.1/api/health

logs:
	docker compose logs --tail=80 api web

stop:
	docker compose stop

test:
	docker compose run --rm -e NODE_ENV=test -e TEST_DATABASE_URL=$${TEST_DATABASE_URL:?Use a separate test database} api npm test
