import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, FormGroup, Validators, FormArray, FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Product {
  id: number;
  name: string;
  measurements: string[];
}

interface OrderItem {
  productName: string;
  measurement: string;
  quantity: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  activeTab: 'order' | 'master' = 'order';
  
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
  showPdfModal: boolean = false;

  // Edit Modal
  showEditModal: boolean = false;
  editingProductId: number | null = null;
  editingProduct: Product = { id: 0, name: '', measurements: [] };
  newVariantSize: string = '';

  constructor(
    private http: HttpClient, 
    private fb: FormBuilder,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit() {
    this.initForms();
    this.loadProductMaster();
    this.loadOrdersFromStorage();
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
      quantity: [1, [Validators.required, Validators.min(1)]]
    });
  }

  // --- Product Master ---
  loadProductMaster() {
    this.http.get<{ products: Product[] }>('assets/db.json').subscribe({
      next: (data) => {
        this.products = data.products;
        // Load any custom products from localStorage
        this.loadProductsFromStorage();
      },
      error: (error) => console.error('Error loading product master:', error)
    });
  }

  loadProductsFromStorage() {
    if (isPlatformBrowser(this.platformId)) {
      const stored = localStorage.getItem('annapoorna_products');
      if (stored) {
        const customProducts = JSON.parse(stored);
        this.products = [...this.products, ...customProducts];
      }
    }
  }

  saveProductsToStorage() {
    if (isPlatformBrowser(this.platformId)) {
      // Get products that are not from db.json (custom ones added after app start)
      const dbProductCount = 4; // Based on initial db.json
      const customProducts = this.products.slice(dbProductCount);
      if (customProducts.length > 0) {
        localStorage.setItem('annapoorna_products', JSON.stringify(customProducts));
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
    
    if (!customSize) {
      return;
    }

    if (!this.availableSizes.includes(customSize)) {
      this.availableSizes.push(customSize);
      alert(`Custom pack size "${customSize}" added successfully!`);
      this.productForm.patchValue({ customSize: '' });
    } else {
      alert('This pack size already exists');
    }
  }

  addProduct() {
    if (this.productForm.invalid) return;

    const newProduct: Product = {
      id: this.products.length + 1,
      name: this.productForm.value.name,
      measurements: this.productForm.value.measurements
    };

    this.products.push(newProduct);
    
    // Save products to localStorage
    this.saveProductsToStorage();
    
    alert(`${newProduct.name} added successfully!`);
    
    this.productForm.reset();
    (this.productForm.get('measurements') as FormArray).clear();
  }

  saveProductsToDb() {
    if (isPlatformBrowser(this.platformId)) {
      const dbProductCount = 4;
      const customProducts = this.products.slice(dbProductCount);
      if (customProducts.length > 0) {
        localStorage.setItem('annapoorna_products', JSON.stringify(customProducts));
      }
    }
  }

  // --- Order Taking ---
  onProductChange(event: any) {
    const index = event.target.value;
    if (index !== '') {
      this.selectedProductSizes = this.products[index].measurements;
      this.orderForm.patchValue({ measurement: '' });
    } else {
      this.selectedProductSizes = [];
    }
  }

  addOrder() {
    if (this.orderForm.invalid) return;

    const formVal = this.orderForm.value;
    const selectedProduct = this.products[formVal.productIndex];

    const orderItem: OrderItem = {
      productName: selectedProduct.name,
      measurement: formVal.measurement,
      quantity: formVal.quantity
    };

    this.savedOrders.push(orderItem);

    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('annapoorna_orders', JSON.stringify(this.savedOrders));
    }
    
    this.orderForm.patchValue({ quantity: 1, measurement: '' });
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

  // --- PDF Logic ---
  openPdfPrompt() {
    if (this.savedOrders.length === 0) return;
    this.showPdfModal = true;
  }

  closePdfPrompt() {
    this.showPdfModal = false;
    this.storeName = '';
    this.storeLocation = '';
  }

  generatePDF() {
    if (!this.storeName || !this.storeLocation) {
      alert("Please fill in both fields.");
      return;
    }

    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Annapoorna Masala - Order Receipt", 14, 20);
    
    doc.setFontSize(11);
    doc.text(`Store Name: ${this.storeName}`, 14, 32);
    doc.text(`Location: ${this.storeLocation}`, 14, 40);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, 48);

    const tableBody = this.savedOrders.map((item, index) => [
      index + 1,
      item.productName,
      item.measurement,
      item.quantity
    ]);

    autoTable(doc, {
      startY: 54,
      head: [['S.No', 'Masala Variety', 'Measurement', 'Quantity']],
      body: tableBody,
    });

    doc.save(`Order_${this.storeName.replace(/\s+/g, '_')}.pdf`);
    this.closePdfPrompt();
  }

  // --- Product Management ---
  editProduct(index: number) {
    const product = this.products[index];
    this.editingProductId = index;
    this.editingProduct = { ...product, measurements: [...product.measurements] };
    this.newVariantSize = '';
    this.showEditModal = true;
  }

  closeEditModal() {
    this.showEditModal = false;
    this.editingProductId = null;
    this.editingProduct = { id: 0, name: '', measurements: [] };
    this.newVariantSize = '';
  }

  addVariantToEdit() {
    const size = this.newVariantSize.trim();
    if (!size) return;

    if (!this.editingProduct.measurements.includes(size)) {
      this.editingProduct.measurements.push(size);
      this.newVariantSize = '';
    } else {
      alert('This pack size already exists for this product');
    }
  }

  removeVariant(index: number) {
    this.editingProduct.measurements.splice(index, 1);
  }

  saveEditedProduct() {
    if (!this.editingProduct.name.trim()) {
      alert('Product name cannot be empty');
      return;
    }

    if (this.editingProduct.measurements.length === 0) {
      alert('Product must have at least one pack size');
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
}