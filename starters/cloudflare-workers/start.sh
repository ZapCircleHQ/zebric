#!/bin/bash
set -e

echo "🚀 Zebric CloudFlare Workers Setup"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "⚠️  Wrangler not found. Installing dependencies..."
    pnpm install
fi

# Check if database ID is configured
if grep -q "your-database-id-here" wrangler.toml; then
    echo "📦 Creating D1 database..."

    # Create the database and capture output
    DB_OUTPUT=$(pnpm wrangler d1 create zebric-db 2>&1)

    # Extract database ID from output
    DB_ID=$(echo "$DB_OUTPUT" | grep -o 'database_id = "[^"]*"' | cut -d'"' -f2)

    if [ -n "$DB_ID" ]; then
        echo "✅ Database created: $DB_ID"

        # Update wrangler.toml with the database ID
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' "s/your-database-id-here/$DB_ID/g" wrangler.toml
        else
            # Linux
            sed -i "s/your-database-id-here/$DB_ID/g" wrangler.toml
        fi

        echo "✅ Updated wrangler.toml with database ID"
    else
        echo "❌ Failed to create database. You may need to create it manually:"
        echo "   pnpm wrangler d1 create zebric-db"
        exit 1
    fi
else
    echo "✅ Database already configured"
fi

# Run migrations
echo "🔄 Running database migrations..."
pnpm wrangler d1 migrations apply DB --local

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start developing:"
echo "  pnpm dev"
echo ""
echo "To deploy to production:"
echo "  pnpm db:migrate:prod  # Run migrations"
echo "  pnpm run deploy           # Deploy app"
echo ""
