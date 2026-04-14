import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { X, Info } from 'lucide-react';
import { GeometryInfo, GeometryProperty } from './geometryProperties';

interface GeometryInfoCardProps {
  geometryInfo: GeometryInfo | null;
  isVisible: boolean;
  onClose: () => void;
}

const GeometryInfoCard: React.FC<GeometryInfoCardProps> = ({
  geometryInfo,
  isVisible,
  onClose
}) => {
  if (!isVisible || !geometryInfo) {
    return null;
  }

  const renderProperty = (property: GeometryProperty, index: number) => (
    <div key={index} className="flex justify-between items-center py-2 border-b border-white/10 last:border-b-0">
      <span className="text-sm font-medium text-white/70">
        {property.label}:
      </span>
      <span className="text-sm text-white font-mono">
        {property.value}
        {property.unit && (
          <span className="text-xs text-white/60 ml-1">{property.unit}</span>
        )}
      </span>
    </div>
  );

  return (
    <div className="fixed left-4 bottom-4 z-50 w-80 animate-in slide-in-from-left-4 duration-300 hidden md:block text-white/70">
      <Card className="shadow-lg border-0 bg-white/5 backdrop-blur-sm border-white/10 rounded-lg xs:rounded-xl sm:rounded-2xl focus-within:border-white/20 transition-all duration-300">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
            </div>
           
          </div>
          
          <div className="flex items-center gap-2 mt-2 text-white/70">
          
            <Badge variant="secondary" className="text-xs bg-white/10 text-white border-white/10">
              {geometryInfo.type}
            </Badge>
        
          
          </div>
          
    
      
        </CardHeader>
        
        <CardContent className="pt-0">
          <div className="space-y-1">
            {geometryInfo.properties.map((property, index) => 
              renderProperty(property, index)
            )}
          </div>
          
          {geometryInfo.properties.length === 0 && (
            <div className="text-sm text-white/60 text-center py-4">
              Bu geometri için özellik bilgisi bulunamadı.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GeometryInfoCard;  