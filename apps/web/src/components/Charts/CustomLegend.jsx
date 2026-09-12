import React from 'react'

const CustomLegend = ({payload}) => {
  return (
    <div className='custom-legend'>
        {payload.map((entry, index) => (
            <div key={`legend-${index}`} className='legend-item'>
                <div className='legend-color-box' style={{backgroundColor: entry.color}}></div>
                <span className='legend-label'>{entry.value}</span>
            </div>
        ))}
    </div>
  )
}

export default CustomLegend