
-- Add form hint columns to category_config
ALTER TABLE public.category_config
  ADD COLUMN IF NOT EXISTS name_placeholder TEXT,
  ADD COLUMN IF NOT EXISTS description_placeholder TEXT,
  ADD COLUMN IF NOT EXISTS price_label TEXT DEFAULT 'Price',
  ADD COLUMN IF NOT EXISTS duration_label TEXT,
  ADD COLUMN IF NOT EXISTS show_veg_toggle BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_duration_field BOOLEAN DEFAULT false;

-- Food categories
UPDATE public.category_config SET
  name_placeholder = 'e.g., Paneer Butter Masala',
  description_placeholder = 'Describe the dish, ingredients, serving size...',
  price_label = 'Price',
  duration_label = 'Prep Time (min)',
  show_veg_toggle = true,
  show_duration_field = true
WHERE category = 'home_food';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Chocolate Truffle Cake',
  description_placeholder = 'Describe the item, flavors, weight...',
  price_label = 'Price',
  duration_label = 'Prep Time (min)',
  show_veg_toggle = true,
  show_duration_field = true
WHERE category = 'bakery';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Masala Vada (6 pcs)',
  description_placeholder = 'Describe the snack, quantity, taste...',
  price_label = 'Price',
  duration_label = 'Prep Time (min)',
  show_veg_toggle = true,
  show_duration_field = true
WHERE category = 'snacks';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Organic Toor Dal 1kg',
  description_placeholder = 'Describe the product, brand, quantity...',
  price_label = 'Price',
  duration_label = NULL,
  show_veg_toggle = true,
  show_duration_field = false
WHERE category = 'groceries';

-- Classes categories
UPDATE public.category_config SET
  name_placeholder = 'e.g., Class 10 Maths - 1hr Session',
  description_placeholder = 'Describe subjects, board, experience...',
  price_label = 'Fee per Session',
  duration_label = 'Session Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'tuition';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Morning Yoga - Beginners',
  description_placeholder = 'Describe the class, level, schedule...',
  price_label = 'Fee per Session',
  duration_label = 'Session Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'yoga';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Bharatanatyam - Intermediate',
  description_placeholder = 'Describe dance style, level, schedule...',
  price_label = 'Fee per Session',
  duration_label = 'Session Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'dance';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Guitar Lessons - Beginner',
  description_placeholder = 'Describe instrument, level, curriculum...',
  price_label = 'Fee per Session',
  duration_label = 'Session Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'music';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Painting Workshop - Acrylic',
  description_placeholder = 'Describe the craft, materials provided...',
  price_label = 'Fee per Session',
  duration_label = 'Session Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'art_craft';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Spoken English - Intermediate',
  description_placeholder = 'Describe language, level, methodology...',
  price_label = 'Fee per Session',
  duration_label = 'Session Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'language';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Zumba Fitness Class',
  description_placeholder = 'Describe workout type, intensity, equipment...',
  price_label = 'Fee per Session',
  duration_label = 'Session Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'fitness';

UPDATE public.category_config SET
  name_placeholder = 'e.g., JEE Maths Coaching',
  description_placeholder = 'Describe exam focus, batch size, schedule...',
  price_label = 'Fee per Session',
  duration_label = 'Session Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'coaching';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Full Day Daycare - Ages 2-5',
  description_placeholder = 'Describe age group, timings, activities...',
  price_label = 'Monthly Fee',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'daycare';

-- Services categories
UPDATE public.category_config SET
  name_placeholder = 'e.g., Switchboard Repair',
  description_placeholder = 'Describe the service, what is included...',
  price_label = 'Starting Rate',
  duration_label = 'Est. Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'electrician';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Tap & Pipe Leak Fix',
  description_placeholder = 'Describe the service, coverage area...',
  price_label = 'Starting Rate',
  duration_label = 'Est. Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'plumber';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Wardrobe Assembly',
  description_placeholder = 'Describe the carpentry work, materials...',
  price_label = 'Starting Rate',
  duration_label = 'Est. Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'carpenter';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Split AC Deep Clean',
  description_placeholder = 'Describe AC type, service details...',
  price_label = 'Starting Rate',
  duration_label = 'Est. Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'ac_service';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Full Home Pest Treatment',
  description_placeholder = 'Describe pest type, area coverage, chemicals used...',
  price_label = 'Starting Rate',
  duration_label = 'Est. Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'pest_control';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Washing Machine Repair',
  description_placeholder = 'Describe appliance types serviced...',
  price_label = 'Starting Rate',
  duration_label = 'Est. Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'appliance_repair';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Daily Housekeeping Service',
  description_placeholder = 'Describe duties, hours, experience...',
  price_label = 'Monthly Salary',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'maid';

UPDATE public.category_config SET
  name_placeholder = 'e.g., North Indian Home Cook',
  description_placeholder = 'Describe cuisine expertise, meals per day...',
  price_label = 'Monthly Salary',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'cook';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Personal Driver - Full Time',
  description_placeholder = 'Describe schedule, vehicle type, license...',
  price_label = 'Monthly Salary',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'driver';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Full-Time Nanny for Toddler',
  description_placeholder = 'Describe age group, hours, experience...',
  price_label = 'Monthly Salary',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'nanny';

-- Personal services
UPDATE public.category_config SET
  name_placeholder = 'e.g., Blouse Stitching',
  description_placeholder = 'Describe garment type, turnaround time...',
  price_label = 'Starting Rate',
  duration_label = 'Est. Duration (days)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'tailoring';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Wash & Iron - 20 pcs',
  description_placeholder = 'Describe service package, fabric types...',
  price_label = 'Price per Load',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'laundry';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Bridal Makeup Package',
  description_placeholder = 'Describe services included, products used...',
  price_label = 'Starting Rate',
  duration_label = 'Est. Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'beauty';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Bridal Mehendi - Full Hands',
  description_placeholder = 'Describe design complexity, coverage...',
  price_label = 'Starting Rate',
  duration_label = 'Est. Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'mehendi';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Haircut & Styling',
  description_placeholder = 'Describe services offered, specialization...',
  price_label = 'Starting Rate',
  duration_label = 'Est. Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'salon';

-- Professional services
UPDATE public.category_config SET
  name_placeholder = 'e.g., ITR Filing for Salaried',
  description_placeholder = 'Describe service scope, documents needed...',
  price_label = 'Consultation Fee',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'tax_consultant';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Laptop OS Reinstall',
  description_placeholder = 'Describe issue types handled, platforms...',
  price_label = 'Consultation Fee',
  duration_label = 'Est. Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'it_support';

UPDATE public.category_config SET
  name_placeholder = 'e.g., IELTS Prep - 1 Month',
  description_placeholder = 'Describe subject, methodology, materials...',
  price_label = 'Fee per Session',
  duration_label = 'Session Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'tutoring';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Professional Resume Writing',
  description_placeholder = 'Describe what is included, turnaround...',
  price_label = 'Service Fee',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'resume_writing';

-- Rentals
UPDATE public.category_config SET
  name_placeholder = 'e.g., Power Drill - Bosch',
  description_placeholder = 'Describe equipment condition, accessories...',
  price_label = 'Rental Rate',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'equipment_rental';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Honda Activa - Self Drive',
  description_placeholder = 'Describe vehicle, mileage, fuel type...',
  price_label = 'Rental Rate',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'vehicle_rental';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Party Tent & Chairs Set',
  description_placeholder = 'Describe items, capacity, condition...',
  price_label = 'Rental Rate',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'party_supplies';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Baby Stroller - Luvlap',
  description_placeholder = 'Describe item, age suitability, condition...',
  price_label = 'Rental Rate',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'baby_gear';

-- Resale
UPDATE public.category_config SET
  name_placeholder = 'e.g., Wooden Dining Table 6-seater',
  description_placeholder = 'Describe condition, dimensions, age...',
  price_label = 'Asking Price',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'furniture';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Samsung TV 55 inch 4K',
  description_placeholder = 'Describe model, condition, warranty status...',
  price_label = 'Asking Price',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'electronics';

UPDATE public.category_config SET
  name_placeholder = 'e.g., NCERT Class 12 Physics',
  description_placeholder = 'Describe edition, condition, markings...',
  price_label = 'Asking Price',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'books';

UPDATE public.category_config SET
  name_placeholder = 'e.g., LEGO City Set - 500 pcs',
  description_placeholder = 'Describe age range, condition, completeness...',
  price_label = 'Asking Price',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'toys';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Prestige Pressure Cooker 5L',
  description_placeholder = 'Describe item, condition, age...',
  price_label = 'Asking Price',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'kitchen';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Men Formal Shirt - Size L',
  description_placeholder = 'Describe brand, size, condition...',
  price_label = 'Asking Price',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'clothing';

-- Events
UPDATE public.category_config SET
  name_placeholder = 'e.g., Veg Catering - 50 pax',
  description_placeholder = 'Describe cuisine, menu options, min order...',
  price_label = 'Starting Rate',
  duration_label = NULL,
  show_veg_toggle = true,
  show_duration_field = false
WHERE category = 'catering';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Birthday Balloon Decoration',
  description_placeholder = 'Describe theme options, coverage area...',
  price_label = 'Starting Rate',
  duration_label = 'Setup Time (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'decoration';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Wedding Photography - Full Day',
  description_placeholder = 'Describe equipment, deliverables, editing...',
  price_label = 'Starting Rate',
  duration_label = 'Coverage Duration (hrs)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'photography';

UPDATE public.category_config SET
  name_placeholder = 'e.g., DJ for House Party - 3hrs',
  description_placeholder = 'Describe music genres, equipment, setup...',
  price_label = 'Starting Rate',
  duration_label = 'Set Duration (hrs)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'dj_music';

-- Pets
UPDATE public.category_config SET
  name_placeholder = 'e.g., Premium Dog Food - 5kg',
  description_placeholder = 'Describe brand, pet type, dietary info...',
  price_label = 'Price',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'pet_food';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Full Body Grooming - Medium Dog',
  description_placeholder = 'Describe services, pet size, breeds handled...',
  price_label = 'Starting Rate',
  duration_label = 'Est. Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'pet_grooming';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Pet Sitting - Weekend',
  description_placeholder = 'Describe pet types, your experience, location...',
  price_label = 'Rate per Day',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'pet_sitting';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Morning Dog Walk - 30min',
  description_placeholder = 'Describe route, dog sizes handled, schedule...',
  price_label = 'Rate per Walk',
  duration_label = 'Walk Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'dog_walking';

-- Property
UPDATE public.category_config SET
  name_placeholder = 'e.g., 2BHK Flat - Tower B, 5th Floor',
  description_placeholder = 'Describe flat, furnishing, amenities...',
  price_label = 'Monthly Rent',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'flat_rent';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Roommate needed - 3BHK Share',
  description_placeholder = 'Describe flat, preferences, sharing terms...',
  price_label = 'Rent Share',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'roommate';

UPDATE public.category_config SET
  name_placeholder = 'e.g., Covered Car Parking - Basement',
  description_placeholder = 'Describe parking type, location, vehicle size...',
  price_label = 'Monthly Rate',
  duration_label = NULL,
  show_veg_toggle = false,
  show_duration_field = false
WHERE category = 'parking';

-- Donation/Puja
UPDATE public.category_config SET
  name_placeholder = 'e.g., Satyanarayan Puja at Home',
  description_placeholder = 'Describe puja type, materials provided, duration...',
  price_label = 'Dakshina / Fee',
  duration_label = 'Est. Duration (min)',
  show_veg_toggle = false,
  show_duration_field = true
WHERE category = 'puja';
