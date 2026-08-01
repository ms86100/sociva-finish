-- Fix seller_profiles.categories column to use service_category[] instead of product_category[]
-- Step 1: Add new column with correct type
ALTER TABLE seller_profiles ADD COLUMN categories_new service_category[] DEFAULT '{}';

-- Step 2: Copy existing data (mapping old values to new enum)
UPDATE seller_profiles 
SET categories_new = categories::text[]::service_category[]
WHERE categories IS NOT NULL AND array_length(categories, 1) > 0;

-- Step 3: Drop old column
ALTER TABLE seller_profiles DROP COLUMN categories;

-- Step 4: Rename new column
ALTER TABLE seller_profiles RENAME COLUMN categories_new TO categories;

-- Step 5: Set constraints
ALTER TABLE seller_profiles ALTER COLUMN categories SET NOT NULL;
ALTER TABLE seller_profiles ALTER COLUMN categories SET DEFAULT '{}';

-- Fix products.category column to use service_category instead of product_category
ALTER TABLE products ALTER COLUMN category TYPE service_category USING category::text::service_category;