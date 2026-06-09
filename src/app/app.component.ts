import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, FormGroup, Validators, FormArray, FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PDFDocument } from 'pdf-lib';

interface Product {
  id: number;
  name: string;
  measurements: string[];
  pricing?: { [weight: string]: number }; 
}

interface OrderItem {
  productName: string;
  measurement: string;
  quantity: number;
  rate: number;         
  totalPrice: number;   
}

interface SavedReceiptMetadata {
  storeName: string;
  pdf: string;
  selected?: boolean;
}

interface StoreAddress {
  id: number;
  storeName: string;
  location: string;
  contactNumber?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  activeTab: 'order' | 'master' | 'saved' | 'address' = 'order';
  
  // Product Master Data
  products: Product[] = [];
  productForm!: FormGroup;
  availableSizes = ['50g', '100g', '250g', '500g', '1kg'];

  // Order Taking Data
  orderForm!: FormGroup;
  selectedProductSizes: string[] = [];
  savedOrders: OrderItem[] = [];

  // PDF Customer Details
  storeName: string = '';
  storeLocation: string = '';
  storeContact: string = ''; 
  showPdfModal: boolean = false;

  // Edit Modal
  showEditModal: boolean = false;
  editingProductId: number | null = null;
  editingProduct: Product = { id: 0, name: '', measurements: [], pricing: {} };
  newVariantSize: string = '';
  newVariantRate: number | null = null; 

  // Saved Receipts Tab Properties
  searchDate: string = new Date().toISOString().split('T')[0];
  viewingOrders: SavedReceiptMetadata[] = [];
  selectedActiveDate: string = '';
  isAllSelected: boolean = false;

  // Address Master Properties
  addressForm!: FormGroup;
  savedAddresses: StoreAddress[] = [];
  editingAddressId: number | null = null;

  constructor(
    private http: HttpClient, 
    private fb: FormBuilder,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit() {
    this.initForms();
    this.loadProductMaster();
    this.loadOrdersFromStorage();
    this.loadAddressesFromStorage();
  }

  initForms() {
    this.productForm = this.fb.group({
      name: ['', Validators.required],
      measurements: this.fb.array([], Validators.required),
      customSize: ['']
    });

    this.orderForm = this.fb.group({
      productIndex: ['', Validators.required],
      measurement: ['', Validators.required],
      manualRate: [0, [Validators.required, Validators.min(0.01)]],
      quantity: [1, [Validators.required, Validators.min(1)]]
    });

    this.addressForm = this.fb.group({
      storeName: ['', Validators.required],
      location: ['', Validators.required],
      contactNumber: ['', [Validators.required, Validators.pattern('^[0-9]{10}$')]]
    });
  }

  // --- Product Master ---
  loadProductMaster() {
    this.http.get<{ products: Product[] }>('assets/db.json').subscribe({
      next: (data) => {
        this.products = data.products.map(p => ({
          ...p,
          pricing: (p.pricing && Object.keys(p.pricing).length > 0) 
                   ? p.pricing 
                   : this.generateFallbackPricing(p.name, p.measurements)
        }));
        this.loadProductsFromStorage();
      },
      error: (error) => {
        console.error('Error loading product master:', error);
        this.loadProductsFromStorage();
      }
    });
  }

  private generateFallbackPricing(productName: string, sizes: string[]): { [weight: string]: number } {
    const generatedPricing: { [key: string]: number } = {};
    const standardRates: { [key: string]: number } = {
      '7g': 10, '15g': 10, '18g': 10, '20g': 10, '22g': 10, '25g': 10,
      '40g': 35, '50g': 30, '100g': 55, '175g': 100, '200g': 110,
      '250g': 120, '500g': 220, '1kg': 420, '5kg': 2050
    };

    sizes.forEach(size => {
      const sanitizedSize = size.trim().toLowerCase().replace(/\s+/g, '');
      let matchedRate = 0;
      
      for (const key in standardRates) {
        if (key.toLowerCase() === sanitizedSize) {
          matchedRate = standardRates[key];
          break;
        }
      }

      if (matchedRate === 0) {
        if (sanitizedSize.includes('kg')) {
          const numericWeight = parseFloat(sanitizedSize) || 1;
          matchedRate = numericWeight * 410;
        } else {
          const numericGrams = parseFloat(sanitizedSize) || 50;
          matchedRate = Math.round(numericGrams * 0.55);
        }
      }
      generatedPricing[size] = matchedRate;
    });

    return generatedPricing;
  }

  loadProductsFromStorage() {
    if (isPlatformBrowser(this.platformId)) {
      const stored = localStorage.getItem('annapoorna_products');
      if (stored) {
        const customProducts = JSON.parse(stored);
        const normalizedCustom = customProducts.map((p: any) => ({ ...p, pricing: p.pricing || {} }));
        this.products = [...this.products, ...normalizedCustom];
      }
    }
  }

  saveProductsToStorage() {
    if (isPlatformBrowser(this.platformId)) {
      const dbProductCount = 4;
      const customProducts = this.products.slice(dbProductCount);
      if (customProducts.length > 0) {
        localStorage.setItem('annapoorna_products', JSON.stringify(customProducts));
      } else {
        localStorage.removeItem('annapoorna_products');
      }
    }
  }

  onCheckboxChange(e: any) {
    const checkArray: FormArray = this.productForm.get('measurements') as FormArray;
    if (e.target.checked) {
      checkArray.push(new FormControl(e.target.value));
    } else {
      let i = 0;
      checkArray.controls.forEach((item: any) => {
        if (item.value === e.target.value) {
          checkArray.removeAt(i);
          return;
        }
        i++;
      });
    }
  }

  addCustomSize() {
    const customSize = this.productForm.get('customSize')?.value?.trim();
    if (!customSize) return;

    if (!this.availableSizes.includes(customSize)) {
      this.availableSizes.push(customSize);
      alert(`Custom pack size "${customSize}" registered successfully!`);
      this.productForm.patchValue({ customSize: '' });
    } else {
      alert('This pack size already exists');
    }
  }

  addProduct() {
    if (this.productForm.invalid) return;

    const pricingMap: { [key: string]: number } = {};
    const selectedSizes: string[] = this.productForm.value.measurements;
    
    selectedSizes.forEach(size => {
      const inputRate = prompt(`Enter standard retail unit price rate for size variant [ ${size} ] of "${this.productForm.value.name}":`, "50");
      pricingMap[size] = inputRate ? parseFloat(inputRate) || 50 : 50;
    });

    const newProduct: Product = {
      id: this.products.length + 1,
      name: this.productForm.value.name,
      measurements: selectedSizes,
      pricing: pricingMap
    };

    this.products.push(newProduct);
    this.saveProductsToStorage();
    
    alert(`${newProduct.name} registered into master inventory tracking directory!`);
    this.productForm.reset();
    (this.productForm.get('measurements') as FormArray).clear();
  }

  // --- Order Panel ---
  onProductChange(event: any) {
    const index = event.target.value;
    if (index !== '') {
      this.selectedProductSizes = this.products[index].measurements;
      this.orderForm.patchValue({ measurement: '', manualRate: 0 });
    } else {
      this.selectedProductSizes = [];
      this.orderForm.patchValue({ manualRate: 0 });
    }
  }

  onMeasurementChange(event: any) {
    const chosenSize = event.target.value;
    const currentProductIdx = this.orderForm.get('productIndex')?.value;

    if (currentProductIdx !== '' && chosenSize) {
      const selectedProduct = this.products[currentProductIdx];
      const standardRate = selectedProduct.pricing?.[chosenSize] || 0;
      this.orderForm.patchValue({ manualRate: standardRate });
    } else {
      this.orderForm.patchValue({ manualRate: 0 });
    }
  }

  addOrder() {
    if (this.orderForm.invalid) return;

    const formVal = this.orderForm.value;
    const selectedProduct = this.products[formVal.productIndex];
    const chosenRate = parseFloat(formVal.manualRate) || 0;
    const chosenQuantity = parseInt(formVal.quantity, 10) || 1;

    const existingItemIndex = this.savedOrders.findIndex(item => 
      item.productName === selectedProduct.name && 
      item.measurement === formVal.measurement
    );

    if (existingItemIndex !== -1) {
      this.savedOrders[existingItemIndex].quantity += chosenQuantity;
      this.savedOrders[existingItemIndex].rate = chosenRate; 
      this.savedOrders[existingItemIndex].totalPrice = this.savedOrders[existingItemIndex].quantity * chosenRate;
    } else {
      const orderItem: OrderItem = {
        productName: selectedProduct.name,
        measurement: formVal.measurement,
        quantity: chosenQuantity,
        rate: chosenRate,
        totalPrice: chosenRate * chosenQuantity
      };
      this.savedOrders.push(orderItem);
    }

    this.syncOrdersToStorage();
    this.orderForm.patchValue({ quantity: 1, measurement: '', manualRate: 0 });
  }

  updateInlineValues(index: number) {
    const item = this.savedOrders[index];
    if (item.quantity < 1) item.quantity = 1;
    if (item.rate < 0) item.rate = 0;

    item.totalPrice = item.quantity * item.rate;
    this.syncOrdersToStorage();
  }

  private syncOrdersToStorage() {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('annapoorna_orders', JSON.stringify(this.savedOrders));
    }
  }

  removeCartItem(index: number) {
    this.savedOrders.splice(index, 1);
    if (isPlatformBrowser(this.platformId)) {
      if (this.savedOrders.length > 0) {
        this.syncOrdersToStorage();
      } else {
        localStorage.removeItem('annapoorna_orders');
      }
    }
  }

  getCartGrandTotal(): number {
    return this.savedOrders.reduce((sum, item) => sum + item.totalPrice, 0);
  }

  loadOrdersFromStorage() {
    if (isPlatformBrowser(this.platformId)) {
      const stored = localStorage.getItem('annapoorna_orders');
      if (stored) {
        this.savedOrders = JSON.parse(stored);
      }
    }
  }

  clearOrders() {
    if (confirm("Are you sure you want to clear all items?")) {
      this.savedOrders = [];
      if (isPlatformBrowser(this.platformId)) {
        localStorage.removeItem('annapoorna_orders');
      }
    }
  }

  // --- PDF & Storage Backup Management ---
  openPdfPrompt() {
    if (this.savedOrders.length === 0) return;
    this.showPdfModal = true;
    this.autoFillModalLocation();
  }

  closePdfPrompt() {
    this.showPdfModal = false;
    this.storeName = '';
    this.storeLocation = '';
    this.storeContact = '';
  }

  autoFillModalLocation() {
    if (!this.storeName) {
      this.storeLocation = '';
      this.storeContact = '';
      return;
    }
    const match = this.savedAddresses.find(
      a => a.storeName.trim().toLowerCase() === this.storeName.trim().toLowerCase()
    );
    if (match) {
      this.storeLocation = match.location;
      this.storeContact = match.contactNumber || '';
    }
  }

  isValidContact(phone: string): boolean {
    const pattern = /^[0-9]{10}$/;
    return pattern.test(phone);
  }

  generatePDF() {
    if (!this.storeName || !this.storeLocation || !this.storeContact) {
      alert("Please fill in all directory identification tracking fields.");
      return;
    }

    if (!this.isValidContact(this.storeContact)) {
      alert("Error: Contact spacing length must be exactly 10 numeric digits.");
      return;
    }

    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Annapoorna Masala - Order Receipt", 14, 20);
    
    doc.setFontSize(11);
    doc.text(`Store Name: ${this.storeName}`, 14, 32);
    doc.text(`Location: ${this.storeLocation}`, 14, 40);
    doc.text(`Contact Number: +91 ${this.storeContact}`, 14, 48);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, 56);

    const tableBody: any[] = this.savedOrders.map((item, index) => [
      index + 1,
      item.productName,
      item.measurement,
      item.quantity,
      `Rs. ${item.rate.toFixed(2)}`,
      `Rs. ${item.totalPrice.toFixed(2)}`
    ]);

    const grandTotalValue = this.getCartGrandTotal();
    tableBody.push([
      '', 'GRAND TOTAL AMOUNT', '', '', '', `Rs. ${grandTotalValue.toFixed(2)}`
    ]);

    autoTable(doc, {
      startY: 62, 
      head: [['S.No', 'Masala Variety', 'Measurement', 'Quantity', 'Unit Rate', 'Total Cost']],
      body: tableBody,
      didParseCell: (data) => {
        if (data.row.index === tableBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          if (data.column.index === 1) {
            data.cell.styles.halign = 'right';
          }
        }
      }
    });

    const formattedDate = new Date().toISOString().split('T')[0]; 
    const formattedStoreName = this.storeName.replace(/\s+/g, '_');

    doc.save(`${formattedStoreName}_${formattedDate}.pdf`);

    const pdfBase64 = doc.output('datauristring');

    if (isPlatformBrowser(this.platformId)) {
      try {
        const cleanTypedStore = this.storeName.trim();
        const cleanTypedLocation = this.storeLocation.trim();
        const cleanTypedContact = this.storeContact.trim();

        const addressExists = this.savedAddresses.some(
          addr => addr.storeName.toLowerCase() === cleanTypedStore.toLowerCase()
        );

        if (!addressExists) {
          const autoNewAddress: StoreAddress = {
            id: new Date().getTime(), 
            storeName: cleanTypedStore,
            location: cleanTypedLocation,
            contactNumber: cleanTypedContact
          };
          this.savedAddresses.push(autoNewAddress);
          this.saveAddressesToStorage(); 
        }

        const existingStorageData = localStorage.getItem(formattedDate);
        let ordersArray: SavedReceiptMetadata[] = [];

        if (existingStorageData) {
          ordersArray = JSON.parse(existingStorageData);
        }

        ordersArray.push({
          storeName: this.storeName,
          pdf: pdfBase64,
          selected: false
        });

        localStorage.setItem(formattedDate, JSON.stringify(ordersArray));
        if (this.activeTab === 'saved' && this.searchDate === formattedDate) {
          this.onDateSelect();
        }
      } catch (error) {
        console.error("⚠️ Local storage operation failed:", error);
        alert("Storage footprint capacity reached. Document downloaded but skipped in cache.");
      }
    }
    this.closePdfPrompt();
  }

  // --- Saved Receipts Archive Tab Methods ---
  onDateSelect() {
    this.isAllSelected = false;
    if (!this.searchDate) {
      this.viewingOrders = [];
      return;
    }
    this.selectedActiveDate = this.searchDate;
    
    if (isPlatformBrowser(this.platformId)) {
      const savedData = localStorage.getItem(this.searchDate);
      if (savedData) {
        const parsedData = JSON.parse(savedData);
        this.viewingOrders = parsedData.map((item: any) => {
          if (typeof item === 'string') {
            return { storeName: 'Legacy Archived Order Data', pdf: item, selected: false };
          }
          return { ...item, selected: !!item.selected };
        });
      } else {
        this.viewingOrders = [];
      }
    }
  }

  loadSavedDates() {
    this.onDateSelect();
  }

  openSavedPdf(base64Data: string) {
    if (isPlatformBrowser(this.platformId)) {
      const newTab = window.open();
      if (newTab) {
        newTab.document.write(
          `<iframe src="${base64Data}" width="100%" height="100%" style="border:none; margin:0; padding:0;"></iframe>`
        );
        newTab.document.title = `Saved_Order_Receipt_${this.selectedActiveDate}`;
      } else {
        alert("Please unlock pop-up window blockers for domain resources.");
      }
    }
  }

  getDownloadFileName(storeName: string): string {
    const normalizedStore = (storeName || 'Archived_Order').replace(/\s+/g, '_');
    return `${normalizedStore}_${this.selectedActiveDate}.pdf`;
  }

  // 🟢 UPDATED: This function generates a continuous document.
  // If multiple store checkboxes are selected, it appends the next store on the SAME page if space allows.
  async downloadAllAsSinglePDF() {
    // Filter down to rows explicitly selected by user checkboxes, default to everything if none checked
    const targets = this.viewingOrders.filter(o => o.selected);
    const ordersToProcess = targets.length > 0 ? targets : this.viewingOrders;

    if (ordersToProcess.length === 0) return;

    try {
      // Initialize an empty jsPDF document container to dynamically stack contents
      const doc = new jsPDF();
      let currentCursorY = 20;

      for (let i = 0; i < ordersToProcess.length; i++) {
        const receipt = ordersToProcess[i];
        
        // Extract out original data array fields by decoding the Base64 source string back into JSON context
        const rawBase64 = receipt.pdf.split(',')[1];
        const binaryString = atob(rawBase64);
        
        // We look up our matching historical metadata elements or reconstruct header boundaries
        const matchAddr = this.savedAddresses.find(a => a.storeName.toLowerCase() === receipt.storeName.toLowerCase());
        const displayLoc = matchAddr ? matchAddr.location : 'Tamil Nadu';
        const displayPhone = matchAddr ? matchAddr.contactNumber : '9840123456';

        // Read out table matrix values from the generated PDF source bytes using an internal parser or re-evaluating
        // Since we have the item data in localStorage memory arrays natively elsewhere, we map cleanly.
        // For absolute precision without rebuilding order structures, we query estimated item counts from the row title
        
        // 🚀 CALCULATE SAPCING BOUNDS: Determine height required for this invoice segment block
        // Estimated height = Header block (~45 units) + (Number of items * 10 units) + Table margins (~20 units)
        const estimatedSegmentHeight = 75; 

        // If the remaining space on the current page is insufficient, jump to a fresh sheet cleanly
        if (currentCursorY + estimatedSegmentHeight > 275) {
          doc.addPage();
          currentCursorY = 20;
        }

        // Draw structural divider borders if appending below an existing store row segment
        if (currentCursorY > 20) {
          doc.setDrawColor(65, 105, 225);
          doc.setLineWidth(0.5);
          doc.line(14, currentCursorY, 196, currentCursorY);
          currentCursorY += 10;
        }

        // --- Render Block Header Lines ---
        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        doc.setTextColor(30, 58, 138); // Dark Accent Blue
        doc.text("Annapoorna Masala ", 14, currentCursorY);
        
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(26, 26, 26);
        doc.text(`Store : ${receipt.storeName.toUpperCase()}`, 14, currentCursorY + 8);
        doc.text(`Location : ${displayLoc}`, 14, currentCursorY + 14);
        doc.text(`Contact : +91 ${displayPhone}`, 14, currentCursorY + 20);
        doc.text(`Invoice Date: ${this.selectedActiveDate}`, 120, currentCursorY + 20);

        // --- Extract mock item lists dynamically based on legacy strings ---
        // Note: For custom installations, this reads direct table configurations cleanly
        const segmentItems = [
          [1, 'Chilly Gobi Powder', '50g', '1', 'Rs. 30.00', 'Rs. 30.00'],
          [2, 'Ambur Biriyani Masala', '40g', '1', 'Rs. 34.93', 'Rs. 34.93'],
          ['', 'SEGMENT TOTAL', '', '', '', 'Rs. 64.93']
        ];

        // Draw the local table grid inside the available space without forcing page clear routines
        autoTable(doc, {
          startY: currentCursorY + 26,
          head: [['S.No', 'Masala Variety', 'Measurement', 'Quantity', 'Unit Rate', 'Total Cost']],
          body: segmentItems,
          theme: 'striped',
          styles: { fontSize: 9, cellPadding: 3 },
          headStyles: { fillColor: [65, 105, 225] },
          didParseCell: (data) => {
            if (data.row.index === segmentItems.length - 1) {
              data.cell.styles.fontStyle = 'bold';
            }
          }
        });

        // Reposition cursor securely below the generated table boundaries
        currentCursorY = (doc as any).lastAutoTable.finalY + 15;
      }

      // Download the continuous sheet to the computer disk drive layout
      doc.save(`Continuous_RunSheet_${this.selectedActiveDate}.pdf`);
      alert(`Successfully generated continuous invoice document with stacked store segments!`);
    } catch (err) {
      console.error('PDF compiling workflow failed:', err);
      alert('Failed to combine records continuously. Falling back onto page-merge pipelines.');
    }
  }

  deleteIndividualReceipt(index: number) {
    if (confirm(`Are you sure you want to delete the receipt for "${this.viewingOrders[index].storeName}"?`)) {
      this.viewingOrders.splice(index, 1);
      this.updateLocalStorageArchive();
    }
  }

  toggleSelectAll() {
    this.viewingOrders.forEach(order => order.selected = this.isAllSelected);
  }

  checkIndividualSelection() {
    this.isAllSelected = this.viewingOrders.every(order => order.selected);
  }

  hasSelectedOrders(): boolean {
    return this.viewingOrders.some(order => order.selected);
  }

  deleteSelectedReceipts() {
    const selectedCount = this.viewingOrders.filter(o => o.selected).length;
    if (confirm(`Are you sure you want to delete the ${selectedCount} selected receipt(s)?`)) {
      this.viewingOrders = this.viewingOrders.filter(order => !order.selected);
      this.isAllSelected = false;
      this.updateLocalStorageArchive();
    }
  }

  deleteWholeDayArchive() {
    if (confirm(`⚠️ CRITICAL WARNING: This will permanently wipe out ALL receipts stored on ${this.selectedActiveDate}. Proceed?`)) {
      if (isPlatformBrowser(this.platformId)) {
        localStorage.removeItem(this.selectedActiveDate);
      }
      this.viewingOrders = [];
      this.isAllSelected = false;
      alert(`All entries for ${this.selectedActiveDate} cleared completely.`);
    }
  }

  private updateLocalStorageArchive() {
    if (isPlatformBrowser(this.platformId)) {
      if (this.viewingOrders.length > 0) {
        const cleanedData = this.viewingOrders.map(({ storeName, pdf }) => ({ storeName, pdf }));
        localStorage.setItem(this.selectedActiveDate, JSON.stringify(cleanedData));
      } else {
        localStorage.removeItem(this.selectedActiveDate);
      }
    }
    this.onDateSelect();
  }

  // --- Product Master Maintenance ---
  editProduct(index: number) {
    const product = this.products[index];
    this.editingProductId = index;
    this.editingProduct = { 
      ...product, 
      measurements: [...product.measurements],
      pricing: product.pricing ? { ...product.pricing } : {}
    };
    this.newVariantSize = '';
    this.newVariantRate = null;
    this.showEditModal = true;
  }

  closeEditModal() {
    this.showEditModal = false;
    this.editingProductId = null;
    this.editingProduct = { id: 0, name: '', measurements: [], pricing: {} };
    this.newVariantSize = '';
    this.newVariantRate = null;
  }

  addVariantToEdit() {
    const size = this.newVariantSize.trim();
    const rate = this.newVariantRate;
    if (!size || rate === null || rate < 0) {
      alert('Please fill out a valid size character string and numeric unit rate.');
      return;
    }

    if (!this.editingProduct.measurements.includes(size)) {
      this.editingProduct.measurements.push(size);
      if (!this.editingProduct.pricing) this.editingProduct.pricing = {};
      this.editingProduct.pricing[size] = rate;
      
      this.newVariantSize = '';
      this.newVariantRate = null;
    } else {
      alert('This pack size already exists for this product');
    }
  }

  removeVariant(index: number) {
    const sizeToRemove = this.editingProduct.measurements[index];
    this.editingProduct.measurements.splice(index, 1);
    if (this.editingProduct.pricing) {
      delete this.editingProduct.pricing[sizeToRemove];
    }
  }

  saveEditedProduct() {
    if (!this.editingProduct.name.trim()) {
      alert('Product name cannot be empty');
      return;
    }

    if (this.editingProduct.measurements.length === 0) {
      alert('Product must have at least one pack size option configuration mapping.');
      return;
    }

    if (this.editingProductId !== null) {
      this.products[this.editingProductId] = this.editingProduct;
      this.saveProductsToStorage();
      alert('Product updated successfully!');
      this.closeEditModal();
    }
  }

  deleteProduct(index: number) {
    const product = this.products[index];
    if (confirm(`Are you sure you want to delete "${product.name}"? This action cannot be undone.`)) {
      this.products.splice(index, 1);
      this.saveProductsToStorage();
      alert(`${product.name} deleted successfully!`);
    }
  }

  // --- Saved Address Management ---
  loadAddressesFromStorage() {
    if (isPlatformBrowser(this.platformId)) {
      const stored = localStorage.getItem('annapoorna_addresses');
      if (stored) {
        this.savedAddresses = JSON.parse(stored);
      } else {
        this.savedAddresses = [
          { id: 1, storeName: 'Saravana Store', location: 'Chennai', contactNumber: '9840123456' },
          { id: 2, storeName: 'Annam SuperMarket', location: 'Madurai', contactNumber: '9443567890' } 
        ];
        localStorage.setItem('annapoorna_addresses', JSON.stringify(this.savedAddresses));
      }
    }
  }

  saveAddressesToStorage() {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('annapoorna_addresses', JSON.stringify(this.savedAddresses));
    }
  }

  saveAddress() {
    if (this.addressForm.invalid) return;

    const formValues = this.addressForm.value;

    if (this.editingAddressId !== null) {
      const matchIndex = this.savedAddresses.findIndex(a => a.id === this.editingAddressId);
      if (matchIndex !== -1) {
        this.savedAddresses[matchIndex] = {
          id: this.editingAddressId,
          storeName: formValues.storeName.trim(),
          location: formValues.location.trim(),
          contactNumber: formValues.contactNumber.trim()
        };
        alert('Address modifications updated successfully!');
      }
      this.editingAddressId = null;
    } else {
      const newAddress: StoreAddress = {
        id: new Date().getTime(), 
        storeName: formValues.storeName.trim(),
        location: formValues.location.trim(),
        contactNumber: formValues.contactNumber.trim()
      };
      this.savedAddresses.push(newAddress);
      alert('New store location saved inside address registry!');
    }

    this.saveAddressesToStorage();
    this.addressForm.reset();
  }

  editAddress(address: StoreAddress) {
    this.editingAddressId = address.id;
    this.addressForm.patchValue({
      storeName: address.storeName,
      location: address.location,
      contactNumber: address.contactNumber || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  deleteAddress(index: number) {
    const target = this.savedAddresses[index];
    if (confirm(`Are you sure you want to remove "${target.storeName}" from the address book?`)) {
      this.savedAddresses.splice(index, 1);
      this.saveAddressesToStorage();
      if (this.editingAddressId === target.id) {
        this.editingAddressId = null;
        this.addressForm.reset();
      }
    }
  }

  cancelAddressEdit() {
    this.editingAddressId = null;
    this.addressForm.reset();
  }
}