// Default settings and bot texts. Seeded into the DB on first run and editable from the admin panel.

export const DEFAULT_SETTINGS: Record<string, string> = {
  storeName: 'Ladies Suits Store',
  currency: 'PKR',
  shippingFee: '250',
  freeShippingOver: '10000', // 0 = never free
  serviceableCities: '', // comma separated; empty = deliver everywhere
  resultsPerPage: '3', // product cards sent per page (each card = 1 WhatsApp message)
  lowStockThreshold: '3',
  codEnabled: 'true',
  maxQtyPerItem: '5',
  aiEnabled: 'true',
  aiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  aiTools:
    'search_products,get_product,search_knowledge,view_cart,add_to_cart,get_order_status,show_products,request_human',
  aiSystemPrompt:
    'You are the friendly sales assistant of a Pakistani ladies suits store on WhatsApp. ' +
    'Be warm, short and helpful (max 4 short lines). Reply in the same language the customer uses: ' +
    'English, Urdu or Roman Urdu. Suggest products that match what the customer wants.',
};

export const DEFAULT_TEXTS: Record<string, { text: string; description: string }> = {
  welcome: {
    text: 'Assalam o Alaikum {name}! 👋\nWelcome to *{store}*. How can we help you today?',
    description: 'Main menu greeting. Variables: {name}, {store}',
  },
  choose_category: { text: 'Please choose a collection 👇', description: 'Category list body' },
  choose_stitching: { text: 'Would you like stitched or unstitched suits?', description: 'Stitching question' },
  choose_size: { text: 'Choose your size (only sizes in stock are shown):', description: 'Size list body' },
  no_results: {
    text: 'Sorry, nothing is in stock for these choices right now. Try another option 👇',
    description: 'No products match',
  },
  results_more: { text: 'Showing {from}-{to} of {total} suits.', description: 'After product cards' },
  choose_variant: { text: 'Choose colour / size:', description: 'Variant list body' },
  ask_quantity: { text: 'How many would you like?', description: 'Quantity question' },
  added_to_cart: { text: '✅ Added to your cart.', description: 'After add to cart' },
  out_of_stock: {
    text: 'Sorry, only {stock} left of this item. Please choose a lower quantity or another option.',
    description: 'Stock check failed',
  },
  cart_empty: { text: 'Your cart is empty. Let’s find you something beautiful!', description: 'Empty cart' },
  edit_cart: { text: 'Tap an item to remove it:', description: 'Edit cart list body' },
  ask_name: { text: 'Great! Let’s get your delivery details.\n\nPlease type your *full name*:', description: 'Checkout step 1' },
  ask_city: { text: 'Which *city* should we deliver to?', description: 'Checkout step 2' },
  city_not_served: {
    text: 'Sorry, we don’t deliver to {city} yet. We deliver to: {cities}.\nPlease type another city:',
    description: 'City not in serviceable list',
  },
  ask_address: { text: 'Please type your complete *address* (house, street, area, landmark):', description: 'Checkout step 3' },
  ask_phone: {
    text: 'Which *phone number* should the courier call? Type it, or use your WhatsApp number.',
    description: 'Checkout step 4',
  },
  saved_address: { text: 'Deliver to your previous address?\n\n{address}', description: 'Returning customer' },
  order_confirmed: {
    text: '🎉 Thank you! Your order *{orderNo}* has been placed.\nTotal: {total} (Cash on Delivery)\n\nOur team will confirm it shortly.',
    description: 'After order placed. Variables: {orderNo}, {total}',
  },
  order_cancelled: { text: 'No problem, the checkout was cancelled. Your cart is saved.', description: 'Checkout cancelled' },
  track_none: { text: 'We couldn’t find any orders on this number.', description: 'No orders' },
  track_pick: { text: 'Select an order to see its status:', description: 'Order list body' },
  handoff: {
    text: 'Thanks! A team member will reply to you here shortly. 🙏\n(Type *menu* anytime to go back to the bot.)',
    description: 'Human handoff',
  },
  stale_option: {
    text: 'That option is no longer current. Here are the latest choices 👇',
    description: 'Old button tapped',
  },
  fallback: { text: 'Sorry, I didn’t get that. Please choose an option 👇', description: 'When nothing matched and AI off/failed' },
  image_received: {
    text: 'Thanks for the picture! 📷 Please tell us what you are looking for, or choose an option below.',
    description: 'Customer sent an image',
  },
};
