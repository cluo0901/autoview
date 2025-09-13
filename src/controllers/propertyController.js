const Property = require('../models/Property');

class PropertyController {
  async getAllProperties(req, res) {
    try {
      const properties = await Property.find({ status: 'active' });
      res.json(properties);
    } catch (error) {
      console.error('Error fetching properties:', error);
      res.status(500).json({ error: 'Failed to fetch properties' });
    }
  }

  async createProperty(req, res) {
    try {
      const property = new Property(req.body);
      await property.save();
      res.status(201).json(property);
    } catch (error) {
      console.error('Error creating property:', error);
      res.status(400).json({ error: 'Failed to create property' });
    }
  }

  async getProperty(req, res) {
    try {
      const property = await Property.findById(req.params.id);
      if (!property) {
        return res.status(404).json({ error: 'Property not found' });
      }
      res.json(property);
    } catch (error) {
      console.error('Error fetching property:', error);
      res.status(500).json({ error: 'Failed to fetch property' });
    }
  }

  async updateProperty(req, res) {
    try {
      const property = await Property.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true }
      );
      if (!property) {
        return res.status(404).json({ error: 'Property not found' });
      }
      res.json(property);
    } catch (error) {
      console.error('Error updating property:', error);
      res.status(400).json({ error: 'Failed to update property' });
    }
  }

  async deleteProperty(req, res) {
    try {
      const property = await Property.findByIdAndDelete(req.params.id);
      if (!property) {
        return res.status(404).json({ error: 'Property not found' });
      }
      res.json({ message: 'Property deleted successfully' });
    } catch (error) {
      console.error('Error deleting property:', error);
      res.status(500).json({ error: 'Failed to delete property' });
    }
  }
}

module.exports = new PropertyController();